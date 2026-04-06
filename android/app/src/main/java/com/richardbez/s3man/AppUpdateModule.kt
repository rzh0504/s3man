package com.richardbez.s3man

import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AppUpdateModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AppUpdateModule"

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    try {
      val canInstall =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
          reactApplicationContext.packageManager.canRequestPackageInstalls()
      promise.resolve(canInstall)
    } catch (error: Exception) {
      promise.reject("ERR_APP_UPDATE_PERMISSION", error)
    }
  }
}
