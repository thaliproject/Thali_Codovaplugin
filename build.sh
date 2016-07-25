#!/bin/sh

### START - JXcore Test Server --------
### Testing environment prepares separate packages for each node.
### Package builder calls this script with each node's IP address
### Make sure multiple calls to this script file compiles the application file

NORMAL_COLOR='\033[0m'
RED_COLOR='\033[0;31m'
GREEN_COLOR='\033[0;32m'
GRAY_COLOR='\033[0;37m'

LOG() {
  COLOR="$1"
  TEXT="$2"
  echo -e "${COLOR}$TEXT ${NORMAL_COLOR}"
}


ERROR_ABORT() {
  if [[ $? != 0 ]]
  then
    LOG $RED_COLOR "compilation aborted\n"
    exit -1
  fi
}
### END - JXcore Test Server   --------

# The build has sometimes failed with the default value of maximum open
# files per process, which is 256. Doubling it here to 512 to workaround
# that issue.
ulimit -n 512

# Remove the previous build result (if any) to start from a clean state.
rm -rf ../ThaliTest;ERROR_ABORT

# Trial to get rid of a build failure that happens only occasionally in CI.
jx npm cache clean

# A hack to workaround an issue where the install scripts assume that the
# folder of the Thali Cordova plugin is called exactly Thali_CordovaPlugin,
# but this isn't always the case in the CI.
# https://github.com/thaliproject/Thali_CordovaPlugin/issues/218
THALI_DIRECTORY="../Thali_CordovaPlugin"
if [ ! -d "$THALI_DIRECTORY" ]
then
  cp -R . $THALI_DIRECTORY
fi

# Check the existence of the script that in CI gives the right test server
# IP address.
if hash CIGIVEMEMYIP.sh 2>/dev/null
then
  SERVER_ADDRESS=$(CIGIVEMEMYIP.sh)
else
  # Passing an empty value as the server address means that the address
  # will be generated later in the build process based on the current host.
  SERVER_ADDRESS=""
fi

# Either PerfTest_app.js or UnitTest_app.js
TEST_TYPE="UnitTest_app.js"

# The line below is really supposed to be 'jx npm run setupUnit -- $SERVER_ADDRESS' but getting the last argument
# passed through npm run and then into sh script seems to be a step too far. Eventually we could use an
# intermediary node.js script to fix this but for now we'll just hack it.
thali/install/setUpTests.sh $TEST_TYPE $SERVER_ADDRESS;ERROR_ABORT

# Remove the node_modules in the CI environment, because the coordination
# server may have different OS and CPU architecture than the build server
# so modules need to be installed there separately (this is handled by the CI).
rm -rf test/TestServer/node_modules;ERROR_ABORT

# A hack workround due to the fact that CI server doesn't allow relative paths outside
# of the original parent folder as a path to the build output binaries.
cp -R ../ThaliTest/platforms/android/build/outputs/apk/android-release-unsigned.apk android-release-unsigned.apk
cp -R ../ThaliTest/platforms/ios/build/device/ThaliTest.app ThaliTest.app
