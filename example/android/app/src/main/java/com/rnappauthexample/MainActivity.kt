package com.rnappauthexample

import android.content.Intent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.rnappauth.RNAppAuthModule

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "RNAppAuthExample"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    // Keeps the authorization result if Android re-created the activity / React instance
    // while the browser was open; picked up by resumePendingAuthorize() in JS.
    if (requestCode == RNAppAuthModule.AUTHORIZATION_REQUEST_CODE) {
      RNAppAuthModule.stashAuthorizationResult(data)
    }
    super.onActivityResult(requestCode, resultCode, data)
  }
}
