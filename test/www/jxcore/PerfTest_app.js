/*
 * This file needs to be renamed as app.js when we want to run performance tests
 * in order this to get loaded by the jxcore ready event.
 * This effectively acts as main entry point to the performance test app
*/

"use strict";

var testUtils = require("./lib/testUtils");
var fs = require('fs');
var parsedJSON = require('serveraddress.json');

testUtils.toggleRadios(true);

var CoordinatorConnector = require('./lib/CoordinatorConnector');
var TestFrameworkClient = require('./perf_tests/PerfTestFramework');

/*----------------------------------------------------------------------------------
 code for connecting to the coordinator server
 -----------------------------------------------------------------------------------*/
var myName = "DEV" + Math.round((Math.random() * (10000)));
testUtils.setMyName(myName);

console.log('my name is : ' + myName);
console.log('Connect to  address : ' + parsedJSON[0].address + ' type: ' + parsedJSON[0].name);

var Coordinator = new CoordinatorConnector();
Coordinator.init(parsedJSON[0].address, 3000);
console.log('attempting to connect to test coordinator');

Coordinator.on('error', function (data) {
  var errData = JSON.parse(data);
  console.log('Error:' + data + ' : ' + errData.type +  ' : ' + errData.data);
  testUtils.logMessageToScreen('Client error: ' + errData.type);
});

/*----------------------------------------------------------------------------------
 code for handling test communications
 -----------------------------------------------------------------------------------*/
var TestFramework = new TestFrameworkClient(myName);
TestFramework.on('done', function (data) {
  console.log('done, sending data to server');
  Coordinator.sendData(data);
});

TestFramework.on('debug', function (data) {
  testUtils.logMessageToScreen(data);
});

Coordinator.on('connect', function () {
  console.log('Client has connected to the server!');
  testUtils.logMessageToScreen('connected to server');
  Coordinator.identify(myName);
});

Coordinator.on('command', function (data) {
  console.log('command received : ' + data);
  TestFramework.handleCommand(data);
});

Coordinator.on('disconnect', function () {
  console.log('The client has disconnected!');
  //we need to stop & close any tests we are running here
  TestFramework.stopAllTests(false);
  testUtils.logMessageToScreen('disconnected');
});

// Log that the app.js file was loaded.
console.log('Test app app.js loaded');



