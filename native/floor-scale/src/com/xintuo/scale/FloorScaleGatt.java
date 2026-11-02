package com.xintuo.scale;

import android.app.Activity;
import android.app.Application;
import android.bluetooth.*;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.Bundle;
import android.os.Build;
import java.lang.ref.WeakReference;
import java.util.ArrayDeque;
import org.json.JSONObject;
import java.util.UUID;

/** Floor-scale-only GATT owner. Never changes the adapter or other clients. */
public final class FloorScaleGatt {
    public interface Listener { void onEvent(String json); }
    private static final UUID SERVICE = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID NOTIFY = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID WRITE = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final int TIMEOUT = 6000;
    // Accessed only on the main looper; prevents two floor pages owning GATT at once.
    private static FloorScaleGatt owner;
    private static boolean poisoned;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Context context;
    private Listener listener;
    private Attempt attempt;
    private final WeakReference<Activity> activity;
    private final Application application;
    private boolean watchingLifecycle;
    private final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
        public void onActivityCreated(Activity a, Bundle b) {}
        public void onActivityStarted(Activity a) {}
        public void onActivityResumed(Activity a) {}
        public void onActivityPaused(Activity a) {}
        public void onActivityStopped(Activity a) {}
        public void onActivitySaveInstanceState(Activity a, Bundle b) {}
        public void onActivityDestroyed(Activity a) {
            if (activity.get() == a) handler.post(() -> { if (attempt != null) terminate(attempt, "activity destroyed", 0); });
        }
    };
    private static final class Sample {
        final byte[] bytes;
        final long receivedAt;
        Sample(byte[] bytes) { this.bytes = bytes; receivedAt = System.currentTimeMillis(); }
    }

    private final class Attempt {
        final String address;
        final OwnedResource<BluetoothGatt> lease = new OwnedResource<>(gatt -> {
            try { gatt.disconnect(); } catch (Exception ignored) { /* close still releases a cancelled/failed attempt. */ }
            gatt.close();
        });
        BluetoothGattCharacteristic notify, write;
        int pending;
        String operation = "";
        boolean ready, subscribed;
        Runnable timeout;
        final ArrayDeque<Sample> queue = new ArrayDeque<>();
        boolean drainScheduled, overflow, closed;
        Attempt(String address) { this.address = address; }
    }

    public FloorScaleGatt(Activity activity, Listener callback) {
        context = activity.getApplicationContext();
        this.activity = new WeakReference<>(activity);
        application = activity.getApplication();
        listener = callback;
    }
    public static int apiVersion() { return 1; }
    private void emit(JSONObject event) {
        try { if (listener != null) listener.onEvent(event.toString()); }
        catch (Exception ignored) { /* A retired JS page cannot prevent native cleanup. */ }
    }
    private JSONObject event(String type) {
        JSONObject out = new JSONObject();
        try { out.put("type", type); } catch (Exception ignored) {}
        return out;
    }
    private void result(int id, boolean ok, String message, JSONObject data) {
        JSONObject out = event("result");
        try { out.put("id", id); out.put("ok", ok); out.put("message", message); out.put("data", data); }
        catch (Exception ignored) {}
        emit(out);
    }
    private boolean current(Attempt a, BluetoothGatt gatt) {
        return attempt == a && !a.lease.isReleased() && a.lease.get() == gatt;
    }
    private void complete(Attempt a, boolean ok, String message, JSONObject data) {
        if (a.timeout != null) handler.removeCallbacks(a.timeout);
        a.timeout = null;
        int id = a.pending; a.pending = 0; a.operation = "";
        if (id != 0) result(id, ok, message, data);
    }
    private void pending(Attempt a, int id, String operation) {
        a.pending = id; a.operation = operation;
        a.timeout = () -> terminate(a, operation + " timeout", -1);
        handler.postDelayed(a.timeout, TIMEOUT);
    }
    private void terminate(Attempt a, String reason, int status) {
        if (attempt != a) return;
        attempt = null;
        synchronized (a) { a.closed = true; a.queue.clear(); }
        if (owner == this) owner = null;
        if (watchingLifecycle) { application.unregisterActivityLifecycleCallbacks(lifecycle); watchingLifecycle = false; }
        // Release BEFORE reporting failure: a retry cannot overwrite a still-owned GATT.
        try { a.lease.release(); }
        catch (Exception failure) { poisoned = true; reason += "; resource close failed; restart app required"; }
        complete(a, false, reason, null);
        JSONObject out = event("disconnected");
        try { out.put("deviceId", a.address); out.put("status", status); out.put("reason", reason); }
        catch (Exception ignored) {}
        emit(out);
    }
    public void connect(final String address, final int id) {
        handler.post(() -> {
            Activity host = activity.get();
            if (host == null || host.isDestroyed() || host.isFinishing()) {
                result(id, false, "activity is no longer available", null); return;
            }
            if (poisoned || attempt != null || (owner != null && owner != this)) {
                result(id, false, poisoned ? "native resource close failed; restart app required" : "floor connection already active", null); return;
            }
            Attempt a = new Attempt(address); attempt = a; owner = this;
            application.registerActivityLifecycleCallbacks(lifecycle); watchingLifecycle = true;
            pending(a, id, "connect");
            try {
                BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
                BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
                if (adapter == null || !adapter.isEnabled()) throw new IllegalStateException("Bluetooth unavailable");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                BluetoothGatt gatt = Build.VERSION.SDK_INT >= 23
                    ? device.connectGatt(context, false, callback(a), BluetoothDevice.TRANSPORT_LE)
                    : device.connectGatt(context, false, callback(a));
                a.lease.assign(gatt);
                if (gatt == null) throw new IllegalStateException("connectGatt returned null");
            } catch (Exception failure) { terminate(a, "connect: " + failure.getMessage(), -1); }
        });
    }
    private BluetoothGattCallback callback(final Attempt a) {
        return new BluetoothGattCallback() {
            @Override public void onConnectionStateChange(BluetoothGatt gatt, int status, int state) {
                handler.post(() -> {
                    if (!current(a, gatt)) return;
                    if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) {
                        terminate(a, "connection ended, status=" + status, status); return;
                    }
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        try { if (!gatt.discoverServices()) terminate(a, "service discovery rejected", -1); }
                        catch (Exception failure) { terminate(a, "service discovery: " + failure.getMessage(), -1); }
                    }
                });
            }
            @Override public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                handler.post(() -> {
                    if (!current(a, gatt) || !"connect".equals(a.operation)) return;
                    if (status != BluetoothGatt.GATT_SUCCESS) { terminate(a, "service discovery status=" + status, status); return; }
                    BluetoothGattService service = gatt.getService(SERVICE);
                    a.notify = service == null ? null : service.getCharacteristic(NOTIFY);
                    a.write = service == null ? null : service.getCharacteristic(WRITE);
                    if (a.notify == null || (a.notify.getProperties() & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) == 0) {
                        terminate(a, "floor notification characteristic missing", -1); return;
                    }
                    a.ready = true;
                    JSONObject data = new JSONObject();
                    try { data.put("notifyProperties", a.notify.getProperties()); data.put("writeProperties", a.write == null ? 0 : a.write.getProperties()); }
                    catch (Exception ignored) {}
                    complete(a, true, "services ready", data);
                });
            }
            @Override public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                handler.post(() -> {
                    if (!current(a, gatt) || !"subscribe".equals(a.operation) || !CCCD.equals(descriptor.getUuid()) || !NOTIFY.equals(descriptor.getCharacteristic().getUuid())) return;
                    if (status != BluetoothGatt.GATT_SUCCESS) { terminate(a, "notification subscription status=" + status, status); return; }
                    a.subscribed = true; complete(a, true, "notifications enabled", null);
                });
            }
            @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                byte[] value = characteristic.getValue();
                receive(a, gatt, characteristic, value == null ? null : value.clone());
            }
            @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
                receive(a, gatt, characteristic, value == null ? null : value.clone());
            }
            @Override public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                handler.post(() -> {
                    if (!current(a, gatt) || !"write".equals(a.operation) || !WRITE.equals(characteristic.getUuid())) return;
                    if (status != BluetoothGatt.GATT_SUCCESS) { terminate(a, "write status=" + status, status); return; }
                    complete(a, true, "write completed; calibration needs verification", null);
                });
            }
        };
    }
    private void receive(Attempt a, BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] bytes) {
        if (!NOTIFY.equals(characteristic.getUuid()) || bytes == null || bytes.length > 512) return;
        synchronized (a) {
            if (a.closed) return;
            if (a.queue.size() >= 128) a.overflow = true;
            else a.queue.add(new Sample(bytes));
            if (a.drainScheduled) return;
            a.drainScheduled = true;
        }
        handler.post(() -> {
            ArrayDeque<Sample> samples;
            boolean overflow;
            synchronized (a) { samples = new ArrayDeque<>(a.queue); a.queue.clear(); a.drainScheduled = false; overflow = a.overflow; }
            if (!current(a, gatt) || (!a.subscribed && !"subscribe".equals(a.operation))) return;
            if (overflow) { terminate(a, "notification queue overflow; stale data discarded", -1); return; }
            for (Sample sample : samples) {
                byte[] value = sample.bytes;
                char[] hex = new char[value.length * 2]; String digits = "0123456789ABCDEF";
                for (int i = 0; i < value.length; i++) { hex[i * 2] = digits.charAt((value[i] >> 4) & 15); hex[i * 2 + 1] = digits.charAt(value[i] & 15); }
                JSONObject out = event("value");
                try { out.put("deviceId", a.address); out.put("hex", new String(hex)); out.put("receivedAt", sample.receivedAt); }
                catch (Exception ignored) {}
                emit(out);
            }
        });
    }
    public void subscribe(final int id) {
        handler.post(() -> {
            Attempt a = attempt;
            if (a == null || !a.ready || a.pending != 0) { result(id, false, "connection not ready or busy", null); return; }
            if (a.subscribed) { result(id, true, "already subscribed", null); return; }
            pending(a, id, "subscribe");
            try {
                BluetoothGatt gatt = a.lease.get();
                BluetoothGattDescriptor descriptor = a.notify.getDescriptor(CCCD);
                if (descriptor == null || !gatt.setCharacteristicNotification(a.notify, true)) throw new IllegalStateException("notification setup rejected");
                byte[] value = (a.notify.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0 ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
                if (!descriptor.setValue(value) || !gatt.writeDescriptor(descriptor)) throw new IllegalStateException("CCCD write rejected");
            } catch (Exception failure) { terminate(a, "subscribe: " + failure.getMessage(), -1); }
        });
    }
    public void write(final String hex, final int id) {
        handler.post(() -> {
            Attempt a = attempt;
            if (a == null || !a.subscribed || a.write == null || a.pending != 0) { result(id, false, "connection not ready or busy", null); return; }
            // The bridge cannot write arbitrary parameters or firmware commands.
            byte[] bytes;
            try {
                if (hex == null || !hex.matches("[0-9A-Fa-f]{16}|[0-9A-Fa-f]{24}")) throw new IllegalArgumentException("invalid calibration command");
                bytes = new byte[hex.length() / 2]; int xor = 0;
                for (int i = 0; i < bytes.length; i++) { bytes[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16); xor ^= bytes[i] & 255; }
                if ((bytes[0] & 255) != 170 || bytes[1] != 1 || bytes[2] != 3 || bytes[3] != bytes.length || bytes[7] != 0 || xor != 0 ||
                    !((bytes.length == 8 && bytes[5] == 1 && bytes[6] == 7) || (bytes.length == 12 && bytes[5] == 5 && bytes[6] == 9))) throw new IllegalArgumentException("invalid calibration command");
            } catch (Exception failure) { result(id, false, failure.getMessage(), null); return; }
            pending(a, id, "write");
            try {
                int properties = a.write.getProperties();
                if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) a.write.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                else if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) a.write.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                else throw new IllegalStateException("write unavailable");
                if (!a.write.setValue(bytes) || !a.lease.get().writeCharacteristic(a.write)) throw new IllegalStateException("write rejected");
            } catch (Exception failure) { terminate(a, "write: " + failure.getMessage(), -1); }
        });
    }
    public void close(final int id) {
        handler.post(() -> {
            if (attempt != null) terminate(attempt, "closed by page", 0);
            result(id, !poisoned, poisoned ? "resource close failed; restart app required" : "closed", null);
        });
    }
}
