/* Copyright (c) 2015-2016 Microsoft Corporation. This software is licensed under the MIT License.
 * See the license file delivered with this project for further information.
 */
package io.jxcore.node;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.CountDownTimer;
import android.util.Log;
import org.thaliproject.p2p.btconnectorlib.ConnectionManager;
import org.thaliproject.p2p.btconnectorlib.ConnectionManager.ConnectionManagerState;
import org.thaliproject.p2p.btconnectorlib.ConnectionManagerSettings;
import org.thaliproject.p2p.btconnectorlib.DiscoveryManager;
import org.thaliproject.p2p.btconnectorlib.DiscoveryManagerSettings;
import org.thaliproject.p2p.btconnectorlib.PeerProperties;
import java.io.IOException;
import java.util.UUID;

/**
 * Wraps the Android connector library functionality and provides an interface for JXcore layer
 * (with the help of JXcoreExtensions class).
 */
public class ConnectionHelper
        implements
            ConnectionManager.ConnectionManagerListener,
            DiscoveryManager.DiscoveryManagerListener,
            HandshakeHelper.Listener {
    private static final String TAG = ConnectionHelper.class.getName();

    public static final int NO_PORT_NUMBER = -1;
    private static final String SERVICE_TYPE = "Cordovap2p._tcp";
    private static final String SERVICE_UUID_AS_STRING = "fa87c0d0-afac-11de-8a39-0800200c9a66";
    private static final String BLE_SERVICE_UUID_AS_STRING = "b6a44ad1-d319-4b3a-815d-8b805a47fb51";
    private static final String BLUETOOTH_NAME = "Thali_Bluetooth";
    private static final UUID SERVICE_UUID = UUID.fromString(SERVICE_UUID_AS_STRING);
    private static final UUID BLE_SERVICE_UUID = UUID.fromString(BLE_SERVICE_UUID_AS_STRING);
    private static final long POWER_UP_BLE_DISCOVERY_DELAY_IN_MILLISECONDS = 15000;
    private static final int MAXIMUM_NUMBER_OF_CONNECTIONS = 30; // TODO: Determine a way to figure out a proper value here, see issue #37

    private final Context mContext;
    private final Thread.UncaughtExceptionHandler mThreadUncaughtExceptionHandler;
    private final ConnectionModel mConnectionModel;
    private final ConnectionManager mConnectionManager;
    private final DiscoveryManager mDiscoveryManager;
    private final DiscoveryManagerSettings mDiscoveryManagerSettings;
    private final ConnectivityInfo mConnectivityInfo;
    private final StartStopOperationHandler mStartStopOperationHandler;
    private final HandshakeHelper mHandshakeHelper;
    private CountDownTimer mPowerUpBleDiscoveryTimer = null;
    private int mServerPortNumber = NO_PORT_NUMBER;

    /**
     * Constructor.
     */
    public ConnectionHelper() {
        mContext = jxcore.activity.getBaseContext();

        mThreadUncaughtExceptionHandler = new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, final Throwable throwable) {
                Log.e(TAG, "Uncaught exception: " + throwable.getMessage(), throwable);
                // Forwarding the exception from here is impossible:
                // "Further exceptions thrown in this method prevent the remainder of the method
                // from executing, but are otherwise ignored."
                // See http://developer.android.com/reference/java/lang/Thread.UncaughtExceptionHandler.html
            }
        };

        mConnectionModel = new ConnectionModel();

        mConnectionManager = new ConnectionManager(mContext, this, SERVICE_UUID, BLUETOOTH_NAME);
        ConnectionManagerSettings connectionManagerSettings = ConnectionManagerSettings.getInstance(mContext);
        connectionManagerSettings.setHandshakeRequired(false);

        mDiscoveryManager = new DiscoveryManager(mContext, this, BLE_SERVICE_UUID, SERVICE_TYPE);
        mDiscoveryManagerSettings = DiscoveryManagerSettings.getInstance(mContext);

        if (mDiscoveryManagerSettings.setDiscoveryMode(DiscoveryManager.DiscoveryMode.BLE)) {
            mDiscoveryManagerSettings.setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY);
            mDiscoveryManagerSettings.setAdvertiseTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH);
            mDiscoveryManagerSettings.setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY);
        } else {
            Log.e(TAG, "Constructor: Bluetooth LE discovery mode is not supported");
        }

        mConnectivityInfo = new ConnectivityInfo(mDiscoveryManager);
        mStartStopOperationHandler = new StartStopOperationHandler(mConnectionManager, mDiscoveryManager);
        mHandshakeHelper = new HandshakeHelper(this);
    }

    /**
     * Should be called when this class instance is no longer needed.
     * Note that after calling this method, this instance cannot be used anymore.
     */
    public void dispose() {
        mStartStopOperationHandler.cancelCurrentOperation();
        mConnectionManager.dispose();
        mDiscoveryManager.dispose();
    }

    /**
     * Starts the connection manager and the discovery manager.
     *
     * @param serverPortNumber    The port on 127.0.0.1 that any incoming connections over the native
     *                            non-TCP/IP transport should be bridged to.
     * @param startAdvertisements If true, will start advertising our presence and scanning for other peers.
     *                            If false, will only scan for other peers.
     * @param callback            The callback to call when we get the (start) operation result.
     * @return True, if started successfully. False otherwise.
     */
    public synchronized boolean start(
            int serverPortNumber, boolean startAdvertisements, JXcoreThaliCallback callback) {
        Log.i(TAG, "start: "
                + "Port number: " + ((serverPortNumber > 0) ? serverPortNumber : mServerPortNumber)
                + ", start advertisements: " + startAdvertisements);

        if (serverPortNumber > 0) {
            mServerPortNumber = serverPortNumber;
        }

        restoreDefaultBleDiscoverySettings();
        mHandshakeHelper.reinitiate();

        if (!mConnectivityInfo.startMonitoring()) {
            Log.e(TAG, "start: Failed to start monitoring the connectivity");
            return false;
        }

        mStartStopOperationHandler.executeStartOperation(startAdvertisements, callback);

        Log.i(TAG, "start: OK");
        return true;
    }

    /**
     * Stops discovery partially (listening) or stops everything depending on the given argument.
     *
     * @param stopOnlyListeningForAdvertisements If true, will only stop listening for advertisements.
     *                                           If false, will stop everything.
     * @param callback The callback to call when we get the (stop) operation result.
     */
    public synchronized void stop(boolean stopOnlyListeningForAdvertisements, JXcoreThaliCallback callback) {
        Log.i(TAG, "stop: "
                + (stopOnlyListeningForAdvertisements
                    ? "Stopping only listening for advertisements"
                    : "Stopping all activities and killing all connections"));

        mStartStopOperationHandler.executeStopOperation(stopOnlyListeningForAdvertisements, callback);

        if (!stopOnlyListeningForAdvertisements) {
            mHandshakeHelper.shutdown();
            mConnectivityInfo.stopMonitoring();
            mConnectionModel.closeAndRemoveAllOutgoingConnections();
        }
    }

    /**
     * Kills all connections.
     *
     * @return The number of incoming connections killed.
     */
    public synchronized int killAllConnections() {
        mConnectionModel.closeAndRemoveAllOutgoingConnections();
        return mConnectionModel.closeAndRemoveAllIncomingConnections();
    }

    /**
     * @return True, if both the connection and the discovery manager are running.
     */
    public boolean isRunning() {
        return (mConnectionManager.getState() != ConnectionManagerState.NOT_STARTED
                && mDiscoveryManager.isRunning());
    }

    /**
     * @return The ConnectivityInfo instance.
     */
    public final ConnectivityInfo getConnectivityInfo() {
        return mConnectivityInfo;
    }

    /**
     * @return The discovery manager instance.
     */
    public final DiscoveryManager getDiscoveryManager() {
        return mDiscoveryManager;
    }

    /**
     * @return The connection model.
     */
    public final ConnectionModel getConnectionModel() {
        return mConnectionModel;
    }

    /**
     * Disconnects the outgoing connection with the given peer ID.
     *
     * @param peerId The ID of the peer to disconnect.
     * @return True, if the peer was found and disconnected.
     */
    public synchronized boolean disconnectOutgoingConnection(final String peerId) {
        Log.d(TAG, "disconnectOutgoingConnection: Trying to close connection to peer with ID " + peerId);
        boolean success = mConnectionModel.closeAndRemoveOutgoingConnectionThread(peerId);

        if (success) {
            Log.i(TAG, "disconnectOutgoingConnection: Successfully disconnected (peer ID: " + peerId);
        } else {
            Log.w(TAG, "disconnectOutgoingConnection: Failed to disconnect (peer ID: " + peerId
                    + "), either no such connection or failed to close the connection");
        }

        return success;
    }

    /**
     * @return Our Bluetooth friendly name or null, if Bluetooth adapter
     * is not resolved or an error occurs while retrieving the name.
     */
    public String getBluetoothName() {
        BluetoothAdapter bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();

        if (bluetoothAdapter != null) {
            return bluetoothAdapter.getName();
        }

        return null;
    }

    /**
     * @return True, if the maximum number of simultaneous connections has been reached (or exceeded).
     */
    public synchronized boolean hasMaximumNumberOfConnections() {
        return (mConnectionModel.getNumberOfCurrentOutgoingConnections() >= MAXIMUM_NUMBER_OF_CONNECTIONS);
    }

    /**
     * Starts the connection process to a peer with the given ID.
     *
     * @param bluetoothMacAddress The Bluetooth MAC address of the peer to connect to.
     * @param callback            The callback that will be associated with the connection.
     * @return Null, if successful. A string with an error description otherwise.
     */
    public synchronized String connect(final String bluetoothMacAddress, JXcoreThaliCallback callback) {
        Log.i(TAG, "connect: Trying to connect to peer with ID " + bluetoothMacAddress);

        if (callback == null) {
            Log.e(TAG, "connect: Callback is null");
            throw new NullPointerException("Callback is null");
        }

        String errorMessage = null;

        if (mConnectionModel.hasOutgoingConnection(bluetoothMacAddress)) {
            errorMessage = "We already have an outgoing connection to peer with ID "
                    + bluetoothMacAddress;
            Log.e(TAG, "connect: " + errorMessage);
            return errorMessage;
        }

        if (mConnectionModel.hasIncomingConnection(bluetoothMacAddress)) {
            Log.i(TAG, "connect: We already have an incoming connection to peer with ID "
                    + bluetoothMacAddress + ", but will connect anyway...");
        }

        if (hasMaximumNumberOfConnections()) {
            errorMessage = "Maximum number of peer connections ("
                    + mConnectionModel.getNumberOfCurrentOutgoingConnections()
                    + ") reached, please try again after disconnecting a peer";
            Log.e(TAG, "connect: " + errorMessage);
            return errorMessage;
        }

        PeerProperties selectedDevice =
                mDiscoveryManager.getPeerModel()
                        .getDiscoveredPeerByBluetoothMacAddress(bluetoothMacAddress);

        if (selectedDevice == null) {
            Log.w(TAG, "connect: The peer to connect to is not amongst the discovered peers, but trying anyway...");
            selectedDevice = new PeerProperties(PeerProperties.NO_PEER_NAME_STRING, bluetoothMacAddress);
        }

        if (!BluetoothAdapter.checkBluetoothAddress(selectedDevice.getBluetoothMacAddress())) {
            errorMessage = "Invalid Bluetooth MAC address: "
                    + selectedDevice.getBluetoothMacAddress();
            Log.e(TAG, "connect: " + errorMessage);
            return errorMessage;
        }

        callback.getListenerOrIncomingConnection().setServerPortNumber(mServerPortNumber);

        if (!mConnectionModel.addOutgoingConnectionCallback(bluetoothMacAddress, callback)) {
            errorMessage = "Failed to add the callback for the connection";
            Log.e(TAG, "connect: " + errorMessage);
            return errorMessage;
        }

        if (mConnectionManager.connect(selectedDevice)) {
            Log.i(TAG, "connect: Connection process successfully started (peer ID: " + bluetoothMacAddress + ")");
        } else {
            errorMessage = "Failed to start connecting";
            Log.e(TAG, "connect: " + errorMessage);
            return errorMessage;
        }

        return null;
    }

    /**
     * Toggles between the system decided and the default alternative insecure RFCOMM port number.
     */
    public void toggleBetweenSystemDecidedAndAlternativeInsecureRfcommPortNumber() {
        ConnectionManagerSettings settings = ConnectionManagerSettings.getInstance(mContext);

        if (settings.getInsecureRfcommSocketPortNumber() ==
                ConnectionManagerSettings.SYSTEM_DECIDED_INSECURE_RFCOMM_SOCKET_PORT) {
            settings.setInsecureRfcommSocketPortNumber(
                    ConnectionManagerSettings.DEFAULT_ALTERNATIVE_INSECURE_RFCOMM_SOCKET_PORT);
        } else {
            settings.setInsecureRfcommSocketPortNumber(
                    ConnectionManagerSettings.SYSTEM_DECIDED_INSECURE_RFCOMM_SOCKET_PORT);
        }
    }

    /**
     * Logs the new state and checks the pending start/stop operations in the queue if any.
     *
     * @param connectionManagerState The new state.
     */
    @Override
    public void onConnectionManagerStateChanged(ConnectionManagerState connectionManagerState) {
        Log.i(TAG, "onConnectionManagerStateChanged: " + connectionManagerState);
        mStartStopOperationHandler.checkCurrentOperationStatus();
    }

    /**
     * Takes ownership of the given Bluetooth socket and initiates a handshake for the connection.
     *
     * @param bluetoothSocket The Bluetooth socket.
     * @param isIncoming      True, if the connection is incoming. False, if it is outgoing.
     * @param peerProperties  The peer properties.
     */
    @Override
    public void onConnected(BluetoothSocket bluetoothSocket, boolean isIncoming, PeerProperties peerProperties) {
        Log.i(TAG, "onConnected: " + (isIncoming ? "Incoming" : "Outgoing")
                + " connection to peer " + peerProperties.toString());

        if (bluetoothSocket == null) {
            Log.e(TAG, "onConnected: Bluetooth socket is null");
            throw new RuntimeException("onConnected: Bluetooth socket is null");
        }

        if (mConnectionModel.hasConnection(peerProperties.getId())) {
            Log.w(TAG, "onConnected: Already connected with peer " + peerProperties.toString() + ", continuing anyway...");
        }

        // Add the peer to the list, if was not discovered before
        mDiscoveryManager.getPeerModel().addOrUpdateDiscoveredPeer(peerProperties);

        if (!mHandshakeHelper.initiateHandshake(bluetoothSocket, peerProperties, isIncoming)) {
            if (!isIncoming) {
                handleOutgoingConnectionFailure(peerProperties, "Failed to initiate handshake");
            }

            try {
                bluetoothSocket.close();
            } catch (IOException e) {
                Log.d(TAG, "onConnected: Failed to close the socket after handshake initiation failed: " + e.getMessage(), e);
            }
        }
    }

    /**
     * Forwards the connection failure to the correct listener.
     *
     * @param peerProperties The peer properties.
     */
    @Override
    public void onConnectionTimeout(PeerProperties peerProperties) {
        if (peerProperties != null) {
            final String bluetoothMacAddress = peerProperties.getBluetoothMacAddress();
            final JXcoreThaliCallback callback =
                    mConnectionModel.getOutgoingConnectionCallbackByBluetoothMacAddress(bluetoothMacAddress);

            if (callback != null) {
                callback.callOnConnectCallback(
                        "Connection to peer " + peerProperties.toString() + " timed out", null);

                // Dispose the callback data
                mConnectionModel.removeOutgoingConnectionCallback(bluetoothMacAddress);
            }

            toggleBetweenSystemDecidedAndAlternativeInsecureRfcommPortNumber();
        }
    }

    /**
     * Forwards the connection failure to the correct listener.
     *
     * @param peerProperties The peer properties.
     * @param errorMessage   The error message.
     */
    @Override
    public void onConnectionFailed(PeerProperties peerProperties, String errorMessage) {
        Log.e(TAG, "onConnectionFailed: Peer properties: " + peerProperties + ", error message: " + errorMessage);

        if (peerProperties != null) {
            handleOutgoingConnectionFailure(peerProperties, errorMessage);
            toggleBetweenSystemDecidedAndAlternativeInsecureRfcommPortNumber();
        }
    }

    /**
     * ThaliPermissions class is responsible for managing permission requests. Thus, we do not try
     * to handle them here, but will return true every time.
     */
    @Override
    public boolean onPermissionCheckRequired(String permission) {
        Log.v(TAG, "Received a request for permission \"" + permission
                + "\", but we are expecting that all the required permissions have already been granted");
        return true;
    }

    /**
     * Stores the new state in ConnectivityInfo instance, which is then responsible to take any
     * actions necessary.
     *
     * @param isEnabled True, if enabled. False, if disabled.
     */
    @Override
    public void onWifiEnabledChanged(boolean isEnabled) {
        mConnectivityInfo.setIsWifiEnabled(isEnabled);
    }

    /**
     * Stores the new state in ConnectivityInfo instance, which is then responsible to take any
     * actions necessary.
     *
     * @param isEnabled True, if enabled. False, if disabled.
     */
    @Override
    public void onBluetoothEnabledChanged(boolean isEnabled) {
        mConnectivityInfo.setIsBluetoothEnabled(isEnabled);
    }

    /**
     * Logs the new state, checks the pending start/stop operations in the queue if any, and
     * forwards the event to the Node layer via JXcoreExtension class.
     *
     * @param state         The new state.
     * @param isDiscovering True, if peer discovery is active. False otherwise.
     * @param isAdvertising True, if advertising is active. False otherwise.
     */
    @Override
    public void onDiscoveryManagerStateChanged(
            DiscoveryManager.DiscoveryManagerState state, final boolean isDiscovering, final boolean isAdvertising) {
        Log.i(TAG, "onDiscoveryManagerStateChanged: State: " + state
                + ", is discovering: " + isDiscovering + ", is advertising: " + isAdvertising);

        mStartStopOperationHandler.checkCurrentOperationStatus();
        JXcoreExtension.notifyDiscoveryAdvertisingStateUpdateNonTcp(isDiscovering, isAdvertising);
    }

    /**
     * Called when a peer is discovered. Tries to add the peer to the list and notifies the listener.
     *
     * @param peerProperties The peer properties.
     */
    @Override
    public void onPeerDiscovered(PeerProperties peerProperties) {
        Log.i(TAG, "onPeerDiscovered: " + peerProperties.toString()
                + ", Bluetooth address: " + peerProperties.getBluetoothMacAddress()
                + ", device name: " + peerProperties.getDeviceName()
                + ", device address: " + peerProperties.getDeviceAddress());

        JXcoreExtension.notifyPeerAvailabilityChanged(peerProperties, true);
    }

    /**
     * Called when one or more properties of a peer already discovered is updated.
     *
     * @param peerProperties The peer properties.
     */
    @Override
    public void onPeerUpdated(PeerProperties peerProperties) {
        Log.i(TAG, "onPeerUpdated: " + peerProperties.toString()
                + ", device name: " + peerProperties.getDeviceName()
                + ", device address: " + peerProperties.getDeviceAddress());
    }

    /**
     * Called when a peer is lost. Tries to remove the peer from the list and notifies the listener.
     *
     * @param peerProperties The peer properties.
     */
    @Override
    public void onPeerLost(PeerProperties peerProperties) {
        Log.i(TAG, "onPeerLost: " + peerProperties.toString());

        if (mConnectionModel.hasConnection(peerProperties.getId())) {
            // If we are still connected, the peer can't certainly be lost, add it back
            mDiscoveryManager.getPeerModel().addOrUpdateDiscoveredPeer(peerProperties);
        } else {
            JXcoreExtension.notifyPeerAvailabilityChanged(peerProperties, false);
        }
    }

    @Override
    public void onProvideBluetoothMacAddressRequest(String requestId) {
        Log.e(TAG, "onProvideBluetoothMacAddressRequest: Request ID: " + requestId + " - Bro Mode is not supported");
        throw new UnsupportedOperationException("Bro Mode is not supported");
    }

    @Override
    public void onPeerReadyToProvideBluetoothMacAddress() {
        Log.d(TAG, "onPeerReadyToProvideBluetoothMacAddress: Bro Mode is not supported");
        throw new UnsupportedOperationException("Bro Mode is not supported");
    }

    @Override
    public void onBluetoothMacAddressResolved(String bluetoothMacAddress) {
        Log.d(TAG, "onBluetoothMacAddressResolved: " + bluetoothMacAddress + " - Bro Mode is not supported");
        throw new UnsupportedOperationException("Bro Mode is not supported");
    }

    /**
     * Handles the new connection with validated handshake.
     *
     * @param bluetoothSocket The Bluetooth socket.
     * @param peerProperties The properties of the peer.
     * @param isIncoming True, if the connection is incoming. False if outgoing.
     */
    @Override
    public void onHandshakeSucceeded(BluetoothSocket bluetoothSocket, PeerProperties peerProperties, boolean isIncoming) {
        Log.d(TAG, "onHandshakeSucceeded: Handshake with peer " + peerProperties
                + " succeeded, the connection is "
                + (isIncoming ? "incoming" : "outgoing"));

        if (isIncoming) {
            handleIncomingConnection(bluetoothSocket, peerProperties);
        } else {
            handleOutgoingConnection(bluetoothSocket, peerProperties);

        }

        Log.d(TAG, "onHandshakeSucceeded: The total number of connections is now "
                + mConnectionModel.getNumberOfCurrentConnections());
    }

    @Override
    public void onHandshakeFailed(BluetoothSocket bluetoothSocket, PeerProperties peerProperties, boolean isIncoming, String reason) {
        Log.e(TAG, "onHandshakeFailed: Handshake with peer " + peerProperties
                + " failed: " + reason + ", the connection was "
                + (isIncoming ? "incoming" : "outgoing"));

        // No need to close the socket - it is already closed (by HandshakeHelper)

        if (!isIncoming) {
            handleOutgoingConnectionFailure(peerProperties, reason);
        }
    }

    /**
     * Constructs the thread around the new outgoing connection and sets the callbacks.
     *
     * @param bluetoothSocket The Bluetooth socket of the new connection.
     * @param peerProperties  The properties of the peer we are now connected to.
     */
    private void handleOutgoingConnection(BluetoothSocket bluetoothSocket, PeerProperties peerProperties) {
        OutgoingSocketThread newOutgoingSocketThread = null;
        final String finalPeerId = peerProperties.getId();
        final JXcoreThaliCallback callback = mConnectionModel.getOutgoingConnectionCallbackByBluetoothMacAddress(finalPeerId);

        try {
            newOutgoingSocketThread = new OutgoingSocketThread(bluetoothSocket, new SocketThreadBase.Listener() {
                @Override
                public void onListeningForIncomingConnections(int portNumber) {
                    Log.i(TAG, "onListeningForIncomingConnections: Outgoing connection is using port "
                            + portNumber + " (peer ID: " + finalPeerId + ")");

                    if (callback != null) {
                        callback.getListenerOrIncomingConnection().setListeningOnPortNumber(portNumber);
                        callback.callOnConnectCallback(null, callback.getListenerOrIncomingConnection());
                    }
                }

                @Override
                public void onDataTransferred(int numberOfBytes) {
                    jxcore.activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            lowerBleDiscoveryPowerAndStartResetTimer();
                        }
                    });
                }

                @Override
                public void onDisconnected(SocketThreadBase who, String errorMessage) {
                    Log.w(TAG, "onDisconnected: Outgoing connection, peer "
                            + who.getPeerProperties().toString()
                            + " disconnected: " + errorMessage);
                    final String peerId = who.getPeerProperties().getId();
                    mConnectionModel.closeAndRemoveOutgoingConnectionThread(peerId);
                }
            });
        } catch (IOException e) {
            Log.e(TAG, "onConnected: Failed to create an outgoing connection thread instance: " + e.getMessage(), e);

            if (callback != null) {
                callback.callOnConnectCallback(
                        "Failed to create an outgoing connection thread instance: " + e.getMessage(), null);
                mConnectionModel.removeOutgoingConnectionCallback(finalPeerId);
            }

            newOutgoingSocketThread = null;
        }

        if (newOutgoingSocketThread != null) {
            lowerBleDiscoveryPowerAndStartResetTimer();

            newOutgoingSocketThread.setUncaughtExceptionHandler(mThreadUncaughtExceptionHandler);
            newOutgoingSocketThread.setPeerProperties(peerProperties);
            mConnectionModel.addConnectionThread(newOutgoingSocketThread);

            newOutgoingSocketThread.start();

            Log.i(TAG, "onConnected: Outgoing socket thread, for peer "
                    + peerProperties + ", created successfully");

            // Use the system decided port the next time, if we're not already using
            ConnectionManagerSettings.getInstance(mContext).setInsecureRfcommSocketPortNumber(
                    ConnectionManagerSettings.SYSTEM_DECIDED_INSECURE_RFCOMM_SOCKET_PORT);
        }
    }

    /**
     * Constructs the thread around the new incoming connection and sets the callbacks.
     *
     * @param bluetoothSocket The Bluetooth socket of the new connection.
     * @param peerProperties  The properties of the peer we are now connected to.
     */
    private void handleIncomingConnection(BluetoothSocket bluetoothSocket, PeerProperties peerProperties) {
        IncomingSocketThread newIncomingSocketThread = null;

        try {
            newIncomingSocketThread = new IncomingSocketThread(bluetoothSocket, new SocketThreadBase.Listener() {
                @Override
                public void onListeningForIncomingConnections(int portNumber) {
                    // Not applicable for incoming connections
                }

                @Override
                public void onDataTransferred(int numberOfBytes) {
                    jxcore.activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            lowerBleDiscoveryPowerAndStartResetTimer();
                        }
                    });
                }

                @Override
                public void onDisconnected(SocketThreadBase who, String errorMessage) {
                    Log.w(TAG, "onDisconnected: Incoming connection, peer "
                            + who.getPeerProperties().toString()
                            + " disconnected: " + errorMessage);

                    final IncomingSocketThread incomingSocketThread = (IncomingSocketThread) who;
                    mConnectionModel.closeAndRemoveIncomingConnectionThread(incomingSocketThread.getId());
                    JXcoreExtension.notifyIncomingConnectionToPortNumberFailed(incomingSocketThread.getTcpPortNumber());
                }
            });
        } catch (IOException e) {
            Log.e(TAG, "onConnected: Failed to create an incoming connection thread instance: " + e.getMessage(), e);
            newIncomingSocketThread = null;
        }

        if (newIncomingSocketThread != null) {
            lowerBleDiscoveryPowerAndStartResetTimer();

            newIncomingSocketThread.setUncaughtExceptionHandler(mThreadUncaughtExceptionHandler);
            newIncomingSocketThread.setPeerProperties(peerProperties);
            newIncomingSocketThread.setTcpPortNumber(mServerPortNumber);
            mConnectionModel.addConnectionThread(newIncomingSocketThread);

            newIncomingSocketThread.start();

            Log.i(TAG, "onConnected: Incoming socket thread, for peer "
                    + peerProperties + ", created successfully");
        }
    }

    /**
     * Notifies the JXcore layer about the connection failure.
     *
     * @param peerProperties The properties of the peer we were trying to connect to.
     * @param errorMessage The error message.
     */
    private synchronized void handleOutgoingConnectionFailure(PeerProperties peerProperties, String errorMessage) {
        final String bluetoothMacAddress = peerProperties.getBluetoothMacAddress();
        final JXcoreThaliCallback callback =
                mConnectionModel.getOutgoingConnectionCallbackByBluetoothMacAddress(bluetoothMacAddress);

        if (callback != null) {
            callback.callOnConnectCallback(
                    "Connection to peer " + peerProperties + " failed: " + errorMessage, null);

            // Dispose the callback data
            mConnectionModel.removeOutgoingConnectionCallback(bluetoothMacAddress);
        }
    }

    /**
     * Lowers the BLE discovery power settings. If the power settings are already changed, the
     * timer for resetting the settings is restarted.
     *
     * This method should be called when a data transfer is started to ensure a reasonable data
     * transfer speed as using BLE for discovery will likely interfere with the data transfer done
     * utilizing Bluetooth sockets because in most modern phones the Bluetooth and BLE stacks
     * share the same 2.4 GHz antenna (along with WiFi).
     */
    private synchronized void lowerBleDiscoveryPowerAndStartResetTimer() {
        if (mPowerUpBleDiscoveryTimer == null) {
            Log.i(TAG, "lowerBleDiscoveryPowerAndStartResetTimer: Lowering the power settings");

            // Create a timer to increase the power used by Bluetooth LE advertiser and scanner
            // once the data transfer is over.
            mPowerUpBleDiscoveryTimer = new CountDownTimer(
                    POWER_UP_BLE_DISCOVERY_DELAY_IN_MILLISECONDS, POWER_UP_BLE_DISCOVERY_DELAY_IN_MILLISECONDS) {
                @Override
                public void onTick(long millisUntilFinished) {
                    // Not used
                }

                @Override
                public void onFinish() {
                    restoreDefaultBleDiscoverySettings();
                }
            };

            mDiscoveryManagerSettings.setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER);
            mDiscoveryManagerSettings.setAdvertiseTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_LOW);
            mDiscoveryManagerSettings.setScanMode(ScanSettings.SCAN_MODE_LOW_POWER);

            mPowerUpBleDiscoveryTimer.start();
        } else {
            // Restart the timer
            mPowerUpBleDiscoveryTimer.cancel();
            mPowerUpBleDiscoveryTimer.start();
        }
    }

    /**
     * Restores the default Bluetooth LE discovery settings.
     */
    private synchronized void restoreDefaultBleDiscoverySettings() {
        if (mPowerUpBleDiscoveryTimer != null) {
            Log.i(TAG, "restoreDefaultBleDiscoverySettings: Powering the BLE discovery back up");
            mPowerUpBleDiscoveryTimer.cancel();
            mPowerUpBleDiscoveryTimer = null;

            mDiscoveryManagerSettings.setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY);
            mDiscoveryManagerSettings.setAdvertiseTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH);
            mDiscoveryManagerSettings.setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY);
        }
    }
}
