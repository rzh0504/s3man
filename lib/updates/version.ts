import Constants from 'expo-constants';
import * as Application from 'expo-application';

import type { AppVersionInfo } from '@/lib/updates/types';

function getConfiguredVersionCode() {
  const value = (Constants.expoConfig?.android as { versionCode?: number } | undefined)
    ?.versionCode;
  return typeof value === 'number' ? value : null;
}

export function getCurrentAppVersion(): AppVersionInfo {
  const configuredVersionName = Constants.expoConfig?.version;
  const configuredVersionCode = getConfiguredVersionCode();
  const parsedBuildVersion = Number.parseInt(Application.nativeBuildVersion ?? '', 10);
  const versionName = configuredVersionName ?? Application.nativeApplicationVersion ?? '0.0.0';
  const versionCode =
    configuredVersionCode ??
    (Number.isFinite(parsedBuildVersion) ? parsedBuildVersion : 0);

  return {
    versionName,
    versionCode,
    displayVersion: `v${versionName} (${versionCode})`,
  };
}
