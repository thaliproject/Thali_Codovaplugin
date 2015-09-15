/**
 * Created by juksilve on 1.9.2015.
 */

'use strict';

var events = require('events');
var TestDevice = require('./TestDevice');
var configFile = require('./Config_UnitTest.json');

function UnitTestFramework() {
    this.testDevices = {};
    this.testsToRunArray = [];

    console.log('Start test : ' + configFile.name + ", start tests with " + configFile.startDeviceCount + " devices.");
}
// to do, we would need timeout for each test, so we can cancel is somebody is hanging

UnitTestFramework.prototype = new events.EventEmitter;

UnitTestFramework.prototype.addDevice = function(device,test) {

    var devName = device.getName();
    var tstName = test;

    console.log(devName + ' added test : ' + tstName);

    if(!this.testDevices[devName]){
        this.testDevices[devName] = {};
    }

    this.testDevices[devName][tstName] = device;

    var count = [];
    for (var deviceName in this.testDevices) {
        if (this.testDevices[deviceName] != null) {
            for (var testName in this.testDevices[deviceName]) {
                //see that is the test which just got added
                if ((tstName == testName) && this.testDevices[deviceName][testName] != null) {
                    count++;
                }
            }
        }
    }

    if (count == configFile.startDeviceCount) {
        var testDevicesReadyArray = [];
        for (var deviceName in this.testDevices) {
            if (this.testDevices[deviceName] != null) {
                for (var testName in this.testDevices[deviceName]) {
                    //see that is the test which just got added
                    if ((tstName == testName) && this.testDevices[deviceName][testName] != null) {
                        var testDevicesReady = {};
                        testDevicesReady.testName   = tstName;
                        testDevicesReady.testDevice = this.testDevices[deviceName][testName];
                        testDevicesReadyArray.push(testDevicesReady);
                        this.testDevices[deviceName][testName] = null;
                    }
                }
            }
        }

        if(!this.testingCurrently){
            //no tests running so we can start with this now
            this.startTheTestNow({"testname":tstName ,"devices" : testDevicesReadyArray});
        }else {
            //we add it to array to wait untill we have finished the currently running test
            this.testsToRunArray.push({"testname":tstName ,"devices" : testDevicesReadyArray});
        }
    }
}

UnitTestFramework.prototype.removeDevice = function(device){

    var devName = device.getName();

    if(this.testDevices[devName]){
        console.log(devName + ' is now disconnected!');
        for(var test in this.testDevices[devName]){
            if(this.testDevices[devName][test] && !this.testDevices[devName][test].done){
                this.ClientStopEventReceived(devName,test);
            }
        }
    }
}

UnitTestFramework.prototype.ClientStopEventReceived = function(devName,tstName) {

    console.log('~ ' + devName + ' test ' + tstName + ' done!');

    if(!this.testingCurrently || this.testingCurrently == null){
        console.log("this.testingCurrently is null");
        return;
    }

    if(!this.testingCurrently.devices || this.testingCurrently.devices == null){
        console.log("this.testingCurrently.devices is null");
        return;
    }

    for (var i = 0; i < this.testingCurrently.devices.length; i++) {
        if (this.testingCurrently.devices[i] && this.testingCurrently.devices[i].testDevice) {
            if (this.testingCurrently.devices[i].testDevice.getName() == devName) {
                //we can now mark this as done
                this.testingCurrently.devices[i].done = true;
            }
        }
    }

    for (var i = 0; i < this.testingCurrently.devices.length; i++) {
        if (this.testingCurrently.devices[i] && this.testingCurrently.devices[i].testDevice) {
            if (!this.testingCurrently.devices[i].done) {
                //not all done yet
                return;
            }
        }
    }

    //if we get here, the test tstName is now done by all devices
    this.stopTheTestNow();
}

UnitTestFramework.prototype.startTheTestNow  = function(testDeviceObject) {
    this.testingCurrently = testDeviceObject;
    console.log('+++++++ starting the test : ' + this.testingCurrently.testname);
    for (var i = 0; i < this.testingCurrently.devices.length; i++) {
        if (this.testingCurrently.devices[i] && this.testingCurrently.devices[i].testDevice) {
            this.testingCurrently.devices[i].testDevice.SendStartUnitTest("");
        }
    }
}

UnitTestFramework.prototype.stopTheTestNow  = function(){
    console.log('------- stopping the test : ' + this.testingCurrently.testname);
    for (var i = 0; i < this.testingCurrently.devices.length; i++) {
        if (this.testingCurrently.devices[i] && this.testingCurrently.devices[i].testDevice) {

            this.testingCurrently.devices[i].testDevice.SendEndUnitTest("");
        }
    }
    this.testingCurrently = null;

    //do next test
    if(this.testsToRunArray && this.testsToRunArray.length >= 1){
        this.testingCurrently = this.testsToRunArray[0];
        this.testsToRunArray.shift();
        this.startTheTestNow(this.testingCurrently);
    }else{
        this.testingCurrently = null;
    }
}

module.exports = UnitTestFramework;