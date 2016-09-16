package com.test.thalitest;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.runner.Result;
import org.thaliproject.p2p.btconnectorlib.PeerProperties;
import java.util.ArrayList;
import java.util.Date;

import io.jxcore.node.ConnectionHelper;
import io.jxcore.node.ConnectionHelperTest;
import io.jxcore.node.jxcore;

public final class RegisterExecuteUT {
    private RegisterExecuteUT() throws Exception {
        throw new Exception("Constructor should not be called.");
    }

    static String TAG = "RegisterExecuteUT";

    private static void FireTestedMethod(String methodName) {
        ConnectionHelperTest.mConnectionHelper = new ConnectionHelper();
        int caseInt = 0;
        
        if (methodName.equals("onPeerLost")) {
            caseInt = 1;
        } else {
            if (methodName.equals("onPeerDiscovered")) {
                caseInt = 2;
            }
        }

        switch (caseInt) {
            case 1:
                ConnectionHelperTest.mConnectionHelper
                        .onPeerLost(new PeerProperties("11:22:33:22:11:00"));
                break;
            case 2:
                ConnectionHelperTest.mConnectionHelper
                        .onPeerDiscovered(new PeerProperties("33:44:55:44:33:22"));
                break;
            default :
                Log.e(TAG, "Method called in FireTestedMethod doesn't exists!");
                break;
        }
    }

    public static void Register() {
        jxcore.RegisterMethod("testNativeMethod", new jxcore.JXcoreCallback() {
            @Override
            public void Receiver(ArrayList<Object> params, final String callbackId) {
                String methodToTest = "";

                if (params.size() == 0) {
                    Log.e(TAG, "Required parameter is missing");
                } else {
                    methodToTest = params.get(0).toString();
                    FireTestedMethod(methodToTest);
                }

                JSONObject jsonObject = new JSONObject();
                try {
                    jsonObject.put("Testing_", methodToTest);
                } catch (JSONException e) {
                    e.printStackTrace();
                }
                final String jsonObjectAsString = jsonObject.toString();

                jxcore.CallJSMethod(callbackId, jsonObjectAsString);
            }
        });

        jxcore.RegisterMethod("executeNativeTests", new jxcore.JXcoreCallback() {
            @Override
            public void Receiver(ArrayList<Object> params, String callbackId) {
                ConnectionHelperTest.mConnectionHelper = new ConnectionHelper();
                String logtag = "ExecuteNativeTests";
                Log.d(logtag, "Running unit tests");
                Result resultTest = ThaliTestRunner.runTests();

                JSONObject jsonObject = new JSONObject();
                Boolean jsonObjectCreated = false;

                try {
                    jsonObject.put("total", resultTest.getRunCount());
                    jsonObject.put("passed", resultTest.getRunCount() -
                            resultTest.getFailureCount() - resultTest.getIgnoreCount());
                    jsonObject.put("failed", resultTest.getFailureCount());
                    jsonObject.put("ignored", resultTest.getIgnoreCount());
                    jsonObject.put("duration", new Date(resultTest.getRunTime()).getTime());
                    jsonObject.put("executed", true);
                    jsonObjectCreated = true;
                } catch (JSONException e) {
                    Log.e(logtag, "executeNativeTests: " +
                            "Failed to populate the JSON object: " + e.getMessage(), e);
                }

                if (jsonObjectCreated) {
                    final String jsonObjectAsString = jsonObject.toString();

                    jxcore.CallJSMethod(callbackId, jsonObjectAsString);
                }
            }
        });
    }
}
