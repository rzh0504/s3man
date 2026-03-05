import { create } from 'zustand';
import type { S3Connection, S3Config, ConnectionStatus } from '@/lib/types';
import { DEFAULT_PROVIDER, DEFAULT_REGION } from '@/lib/constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as S3Service from '@/lib/s3-service';

const STORAGE_KEY = 's3man_connections';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/** Serialisable shape persisted to SecureStore (no runtime status) */
interface SavedConnection {
  id: string;
  displayName: string;
  config: S3Config;
}

interface ConnectionState {
  connections: S3Connection[];
  /** true until the first loadConnections() call finishes */
  isInitializing: boolean;

  /** Boot: load from storage → auto-connect all */
  loadConnections: () => Promise<void>;

  /** Add a brand-new connection (tests first, auto-saves) */
  addConnection: (displayName: string, config: S3Config) => Promise<void>;

  /** Update an existing connection's config (re-tests, auto-saves) */
  updateConnection: (id: string, displayName: string, config: S3Config) => Promise<void>;

  /** Remove a connection (destroys client, auto-saves) */
  removeConnection: (id: string) => Promise<void>;

  /** Reconnect a single connection */
  connectOne: (id: string) => Promise<void>;

  /** Disconnect a single connection */
  disconnectOne: (id: string) => void;

  /** Convenience: current number of connected providers */
  connectedCount: () => number;

  /** Internal: update status of one connection */
  _setStatus: (id: string, status: ConnectionStatus, error?: string) => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  isInitializing: true,

  _setStatus: (id, status, error) =>
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === id ? { ...c, status, errorMessage: error } : c
      ),
    })),

  connectedCount: () => get().connections.filter((c) => c.status === 'connected').length,

  // ── Persistence ──────────────────────────────────────────────────────────

  loadConnections: async () => {
    try {
      let json: string | null = null;
      if (Platform.OS === 'web') {
        json = localStorage.getItem(STORAGE_KEY);
      } else {
        json = await SecureStore.getItemAsync(STORAGE_KEY);
      }

      if (!json) {
        // Migrate from old single-config key
        const legacyJson = Platform.OS === 'web'
          ? localStorage.getItem('s3man_config')
          : await SecureStore.getItemAsync('s3man_config');

        if (legacyJson) {
          const legacyConfig = JSON.parse(legacyJson) as S3Config;
          const migrated: SavedConnection = {
            id: generateId(),
            displayName: legacyConfig.provider === 'cloudflare-r2' ? 'Cloudflare R2' :
              legacyConfig.provider === 'backblaze-b2' ? 'Backblaze B2' :
              legacyConfig.provider === 'aws-s3' ? 'Amazon S3' : 'Custom S3',
            config: {
              provider: legacyConfig.provider ?? DEFAULT_PROVIDER,
              endpointUrl: legacyConfig.endpointUrl ?? '',
              accessKeyId: legacyConfig.accessKeyId ?? '',
              secretAccessKey: legacyConfig.secretAccessKey ?? '',
              region: legacyConfig.region ?? DEFAULT_REGION,
              accountId: legacyConfig.accountId ?? '',
            },
          };
          json = JSON.stringify([migrated]);
          // Clean up legacy key
          if (Platform.OS === 'web') {
            localStorage.removeItem('s3man_config');
          } else {
            await SecureStore.deleteItemAsync('s3man_config');
          }
        }
      }

      if (json) {
        const saved: SavedConnection[] = JSON.parse(json);
        const connections: S3Connection[] = saved.map((s) => ({
          ...s,
          status: 'connected' as ConnectionStatus,
        }));
        // Create S3 clients without network test (verified on first bucket fetch)
        for (const c of connections) {
          S3Service.createClientForConnection(c.id, c.config);
        }
        set({ connections, isInitializing: false });
      } else {
        set({ isInitializing: false });
      }
    } catch {
      set({ isInitializing: false });
      // ignore parse/load errors
    }
  },

  addConnection: async (displayName, config) => {
    const id = generateId();
    const conn: S3Connection = {
      id,
      displayName,
      config,
      status: 'connecting',
    };
    set((state) => ({ connections: [...state.connections, conn] }));

    try {
      S3Service.createClientForConnection(id, config);
      await S3Service.testConnectionById(id);
      get()._setStatus(id, 'connected');
    } catch (error: any) {
      get()._setStatus(id, 'error', error.message || 'Connection failed');
      throw error;
    } finally {
      await _persist(get().connections);
    }

    // Register proxy alias in Worker KV (best-effort, non-blocking)
    S3Service.registerProxyAlias(id).catch(() => {});
  },

  updateConnection: async (id, displayName, config) => {
    // Destroy old client
    S3Service.destroyClientForConnection(id);

    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === id ? { ...c, displayName, config, status: 'connecting', errorMessage: undefined } : c
      ),
    }));

    try {
      S3Service.createClientForConnection(id, config);
      await S3Service.testConnectionById(id);
      get()._setStatus(id, 'connected');
    } catch (error: any) {
      get()._setStatus(id, 'error', error.message || 'Connection failed');
      throw error;
    } finally {
      await _persist(get().connections);
    }

    // Re-register proxy alias in Worker KV (best-effort, non-blocking)
    S3Service.registerProxyAlias(id).catch(() => {});
  },

  removeConnection: async (id) => {
    // Unregister proxy alias from Worker KV (best-effort)
    const conn = get().connections.find((c) => c.id === id);
    if (conn) S3Service.unregisterProxyAlias(conn.config).catch(() => {});

    S3Service.destroyClientForConnection(id);
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
    }));
    await _persist(get().connections);
  },

  connectOne: async (id) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;

    get()._setStatus(id, 'connecting');
    try {
      S3Service.createClientForConnection(id, conn.config);
      await S3Service.testConnectionById(id);
      get()._setStatus(id, 'connected');
    } catch (error: any) {
      get()._setStatus(id, 'error', error.message || 'Connection failed');
    }
  },

  disconnectOne: (id) => {
    S3Service.destroyClientForConnection(id);
    get()._setStatus(id, 'disconnected');
  },
}));

// ── Internal persistence helper ──────────────────────────────────────────

async function _persist(connections: S3Connection[]): Promise<void> {
  const saved: SavedConnection[] = connections.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    config: c.config,
  }));
  const json = JSON.stringify(saved);
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {}
  } else {
    await SecureStore.setItemAsync(STORAGE_KEY, json);
  }
}
