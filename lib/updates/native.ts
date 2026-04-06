import { NativeModules, Platform } from 'react-native';

type AppUpdateModuleShape = {
  canRequestPackageInstalls?: () => Promise<boolean>;
};

const appUpdateModule = NativeModules.AppUpdateModule as AppUpdateModuleShape | undefined;

export async function canRequestPackageInstalls() {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (typeof appUpdateModule?.canRequestPackageInstalls !== 'function') {
    return false;
  }

  return appUpdateModule.canRequestPackageInstalls();
}
