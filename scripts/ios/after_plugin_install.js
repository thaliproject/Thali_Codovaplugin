//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license. See LICENSE.txt file in the project root
//  for full license information.
//

'use strict';

var fs = require('fs');
var nativeInstaller = require('../../thali/install/ios/nativeInstaller');
var path = require('path');

function loadIsTestEnvironment() {
  var utFlatFilePath = 'platforms/ios/unittests';

  try {
    var utFlag = fs.lstatSync(utFlatFilePath);

    try {
      console.log('Removing UT flag');

      fs.unlinkSync(utFlatFilePath);
    } catch (err) {
      console.log(err);
      console.log('Failed to remove the UT flag file, continuing anyway');
    }

    return utFlag.isFile();
  } catch (err) {
    console.log('Not a test environment, continue normally.');
    return false;
  }
};

module.exports = function (context) {

    var isTestEnvironment = loadIsTestEnvironment();

    // Need a promise so that
    // the install waits for us to complete our project modifications
    // before the plugin gets installed.
    var Q = context.requireCordovaModule('q');
    var deferred = new Q.defer();

    // Only bother if we're on macOS
    if (process.platform !== 'darwin') {
      deferred.resolve();
      return deferred.promise;
    }

    var platforms = context.opts.cordova.platforms;

    // We can bail out if the iOS platform isn't present.
    if (platforms.indexOf('ios') === -1) {
      deferred.resolve();
      return deferred.promise;
    }

    // We need to build ThaliCore.framework before embedding it into the project

    var thaliCoreProjectFolder = path.join(
      context.opts.plugin.dir, 'lib', 'ios', 'ThaliCore');
    var thaliCoreOutputFolder = path.join(
      context.opts.plugin.dir, 'lib', 'ios');

    // We need to embded frameworks to the project here.
    // They need to be embedded binaries and cordova does not yet support that.
    // We will use node-xcode directy to add them since that library has
    // been upgraded to support embedded binaries.

    // Cordova libs to get the project path and project name
    // so we can locate the xcode project file.
    var cordova_util = context.requireCordovaModule('cordova-lib/src/cordova/util'),
        ConfigParser = context.requireCordovaModule('cordova-lib').configparser,
        appRoot = context.opts.projectRoot,
        projectRoot = cordova_util.isCordova(),
        xml = cordova_util.projectConfig(projectRoot),
        cfg = new ConfigParser(xml);

    var projectPath = path.join(
      projectRoot, 'platforms', 'ios', cfg.name() + '.xcodeproj');

    return nativeInstaller.addFramework(
      projectPath, thaliCoreProjectFolder, thaliCoreOutputFolder, isTestEnvironment);
  };
