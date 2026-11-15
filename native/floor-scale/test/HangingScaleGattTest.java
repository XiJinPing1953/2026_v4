package com.xintuo.scale;

import android.app.Activity;
import android.app.Application;
import android.bluetooth.*;
import android.os.Handler;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Runs the new NVK mode through the same actual driver as the floor scale. */
public final class HangingScaleGattTest {
    private static final UUID NOTIFY = UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    public static void main(String[] args) {
        Handler.reset();
        BluetoothAdapter adapter = new BluetoothAdapter();
        Application app = new Application(); app.bluetoothManager = new BluetoothManager(adapter);
        Activity activity = new Activity(app);
        List<String> events = new ArrayList<>();
        FloorScaleGatt driver = new FloorScaleGatt(activity, events::add, true);
        check(FloorScaleGatt.hangingApiVersion() == 1, "missing native capability");
        // Reproduce the field failure: unavailable old device, no callbacks even
        // after disconnect(). The driver must close and permit another address.
        for (int i = 1; i <= 50; i++) {
            driver.connect("98:DA:C0:00:75:28", i); Handler.runReady();
            BluetoothGatt failed = adapter.gatts.get(adapter.gatts.size() - 1);
            Handler.advanceBy(6000);
            check(failed.closeCalls == 1 && adapter.liveCount() == 0, "silent connect leaked GATT");
            check(app.callbacks.isEmpty() && Handler.pendingCount() == 0, "timeout leaked listener/timer");
        }
        BluetoothGatt old = adapter.gatts.get(0);
        driver.connect("98:DA:C0:00:74:67", 100); Handler.runReady();
        BluetoothGatt current = adapter.gatts.get(adapter.gatts.size() - 1);
        BluetoothGattCharacteristic notify = new BluetoothGattCharacteristic(NOTIFY, BluetoothGattCharacteristic.PROPERTY_NOTIFY);
        notify.descriptors.put(CCCD, new BluetoothGattDescriptor(CCCD, notify));
        current.service.characteristics.put(NOTIFY, notify);
        current.callback.onConnectionStateChange(current, 0, BluetoothProfile.STATE_CONNECTED); Handler.runReady();
        current.callback.onServicesDiscovered(current, 0); Handler.runReady();
        check(events.stream().anyMatch(e -> e.contains("\"id\":100,\"ok\":true")), "NVK FFE1 not discovered");
        driver.subscribe(101); Handler.runReady();
        check(current.descriptorCalls == 1, "CCCD not written");
        check(events.stream().noneMatch(e -> e.contains("\"id\":101,\"ok\":true")), "subscribed before acknowledgement");
        current.callback.onDescriptorWrite(current, current.lastDescriptor, 0); Handler.runReady();
        check(events.stream().anyMatch(e -> e.contains("\"id\":101,\"ok\":true")), "CCCD not acknowledged");
        current.callback.onCharacteristicChanged(current, notify, new byte[]{83, 84, 44, 49}); Handler.runReady();
        check(events.stream().anyMatch(e -> e.contains("\"hex\":\"53542C31\"") && e.contains("74:67")), "NVK bytes/address lost");
        int before = events.size();
        old.callback.onConnectionStateChange(old, 0, BluetoothProfile.STATE_CONNECTED);
        old.callback.onServicesDiscovered(old, 0); Handler.runReady();
        check(events.size() == before && !current.closed, "old callback affected new scale");
        driver.write("AA010308A6010700", 102); Handler.runReady();
        check(current.writeCalls == 0, "NVK received a floor calibration command");
        // The floor channel can own its own connection. Closing either mode
        // must not reset Bluetooth or release the other mode's native resource.
        FloorScaleGatt floor = new FloorScaleGatt(activity, event -> {});
        floor.connect("F3:27:81:36:A0:A7", 103); Handler.runReady();
        check(adapter.liveCount() == 2, "floor and hanging ownership coupled");
        driver.close(104); Handler.runReady();
        check(current.closeCalls == 1 && adapter.liveCount() == 1, "closing NVK affected floor");
        floor.close(105); Handler.runReady();
        check(adapter.liveCount() == 0 && app.callbacks.isEmpty() && Handler.pendingCount() == 0, "cleanup incomplete");
        System.out.println("HangingScaleGatt: 50 silent timeouts, address change, CCCD, raw frames, late callbacks, read-only and floor isolation passed; actual Android/radio acceptance pending.");
    }
}
