#!/usr/bin/env bash

set -euo pipefail

echo "Start setUpDesktop.sh"

NORMAL_COLOR='\033[0m'
RED_COLOR='\033[0;31m'

OUTPUT() {
  echo -e "${RED_COLOR}$BASH_COMMAND FAILED - setUpDesktop failure${NORMAL_COLOR}"
}

trap OUTPUT ERR

NVM_NODEJS_ORG_MIRROR=https://jxcore.azureedge.net
export NVM_NODEJS_ORG_MIRROR
JX_NPM_JXB=jxb311
export JX_NPM_JXB

echo "Setup TestServer"
cd `dirname $0`
cd ../../test/TestServer
npm install --no-optional
node generateServerAddress.js

echo "Install Thali Root"
cd ../../thali
jx npm install --no-optional
npm link

echo "Install Thali Install Directory"
cd install
npm install --no-optional
node validateBuildEnvironment.js

echo "Final Desktop Step"
cd ../../test/www/jxcore
npm link thali
node installCustomPouchDB.js
jx npm install --no-optional

echo "End setUpDesktop.sh"
