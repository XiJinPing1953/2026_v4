package com.xintuo.scale;

import android.app.Activity;
import android.app.Application;
import android.bluetooth.*;
import android.os.Handler;
import java.lang.reflect.Field;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Fault replay against the actual production driver, with deterministic platform boundaries. */
public final class FloorScaleGattTest {
    private static final UUID NOTIFY = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID WRITE = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static int passed;
    private interface Case { void run() throws Exception; }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static Object field(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(object);
    }
    private static void resetProcess() throws Exception {
        Handler.reset();
        for (String name : new String[]{"owner", "poisoned"}) {
            Field field = FloorScaleGatt.class.getDeclaredField(name); field.setAccessible(true);
            if (name.equals("poisoned")) field.setBoolean(null, false); else field.set(null, null);
        }
    }
    private static void test(String name, Case body) throws Exception {
        resetProcess(); body.run(); passed++; System.out.println("PASS " + name);
    }
    private static final class Fixture {
        final BluetoothAdapter adapter = new BluetoothAdapter();
        final Application app = new Application();
        final Activity activity;
        final List<String> events = new ArrayList<>();
        final FloorScaleGatt driver;
        Fixture() {
            app.bluetoothManager = new BluetoothManager(adapter);
            activity = new Activity(app);
            driver = new FloorScaleGatt(activity, events::add);
        }
        BluetoothGatt connect(int id) {
            driver.connect("F3:27:81:36:A0:A7", id); Handler.runReady();
            return adapter.gatts.get(adapter.gatts.size() - 1);
        }
        BluetoothGatt ready(int id) {
            BluetoothGatt gatt = connect(id);
            BluetoothGattCharacteristic notify = new BluetoothGattCharacteristic(NOTIFY, BluetoothGattCharacteristic.PROPERTY_NOTIFY);
            notify.descriptors.put(CCCD, new BluetoothGattDescriptor(CCCD, notify));
            gatt.service.characteristics.put(NOTIFY, notify);
            gatt.service.characteristics.put(WRITE, new BluetoothGattCharacteristic(WRITE, BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE));
            gatt.callback.onConnectionStateChange(gatt, 0, BluetoothProfile.STATE_CONNECTED); Handler.runReady();
            gatt.callback.onServicesDiscovered(gatt, 0); Handler.runReady();
            check(result(id, true) == 1, "connect must complete exactly once after discovery");
            return gatt;
        }
        BluetoothGatt subscribed() {
            BluetoothGatt gatt = ready(1);
            driver.subscribe(2); Handler.runReady();
            gatt.callback.onDescriptorWrite(gatt, gatt.lastDescriptor, 0); Handler.runReady();
            check(result(2, true) == 1, "subscribe completion missing");
            return gatt;
        }
        long result(int id, boolean ok) {
            String token = "\"id\":" + id + ",\"ok\":" + ok;
            return events.stream().filter(e -> e.contains("\"type\":\"result\"") && e.contains(token)).count();
        }
        long values() { return events.stream().filter(e -> e.contains("\"type\":\"value\"")).count(); }
        void notify(BluetoothGatt gatt, byte[] bytes) {
            gatt.callback.onCharacteristicChanged(gatt, gatt.service.getCharacteristic(NOTIFY), bytes);
        }
        void close() { driver.close(900); Handler.runReady(); }
        void released(BluetoothGatt gatt) {
            check(gatt.closeCalls == 1 && gatt.closed, "GATT must close exactly once");
            check(adapter.liveCount() == 0, "GATT resource accumulated");
            check(app.callbacks.isEmpty(), "lifecycle registration leaked");
            check(Handler.pendingCount() == 0, "pending callbacks leaked");
        }
    }

    public static void main(String[] args) throws Exception {
        test("50 connection failures close each GATT without accumulating clients", () -> {
            Fixture f = new Fixture();
            for (int id = 1; id <= 50; id++) {
                BluetoothGatt gatt = f.connect(id);
                gatt.callback.onConnectionStateChange(gatt, 133, BluetoothProfile.STATE_DISCONNECTED); Handler.runReady();
                check(f.result(id, false) == 1, "failure callback must settle once"); f.released(gatt);
                Handler.advanceBy(7000); check(gatt.closeCalls == 1, "retired watchdog must not close twice");
            }
        });
        test("50 silent connect timeouts close without a platform disconnect callback", () -> {
            Fixture f = new Fixture();
            for (int id = 1; id <= 50; id++) {
                BluetoothGatt gatt = f.connect(id); Handler.advanceBy(5999);
                check(gatt.closeCalls == 0, "connect deadline fired early"); Handler.advanceBy(1);
                check(f.result(id, false) == 1, "timeout must settle once"); f.released(gatt);
            }
        });
        test("late callbacks from released GATT cannot alter a new attempt", () -> {
            Fixture f = new Fixture(); BluetoothGatt old = f.connect(10); Handler.advanceBy(6000);
            BluetoothGatt current = f.ready(11); int eventCount = f.events.size();
            old.callback.onConnectionStateChange(old, 0, BluetoothProfile.STATE_CONNECTED);
            old.callback.onServicesDiscovered(old, 0);
            old.callback.onConnectionStateChange(old, 133, BluetoothProfile.STATE_DISCONNECTED);
            Handler.runReady();
            check(current.closeCalls == 0 && f.adapter.liveCount() == 1, "old callback closed new GATT");
            check(old.discoveryCalls == 0 && f.events.size() == eventCount, "old callback emitted state"); f.close();
        });
        test("subscription waits for matching CCCD acknowledgement and permits early data", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.ready(1);
            f.driver.subscribe(2); Handler.runReady();
            check(gatt.descriptorCalls == 1 && f.result(2, true) == 0, "subscription succeeded before CCCD reply");
            f.notify(gatt, new byte[]{1, 2}); Handler.runReady(); check(f.values() == 1, "early notification lost");
            BluetoothGattDescriptor foreign = new BluetoothGattDescriptor(CCCD, gatt.service.getCharacteristic(WRITE));
            gatt.callback.onDescriptorWrite(gatt, foreign, 0); Handler.runReady();
            check(f.result(2, true) == 0, "foreign descriptor completed subscription");
            gatt.callback.onDescriptorWrite(gatt, gatt.lastDescriptor, 0); Handler.runReady();
            check(f.result(2, true) == 1, "CCCD success missing");
            Handler.advanceBy(6000); check(!gatt.closed, "completed subscription watchdog still active"); f.close(); f.released(gatt);
        });
        test("CCCD failure releases the connection", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.ready(1); f.driver.subscribe(2); Handler.runReady();
            gatt.callback.onDescriptorWrite(gatt, gatt.lastDescriptor, 5); Handler.runReady();
            check(f.result(2, false) == 1, "descriptor error not returned"); f.released(gatt);
        });
        test("CCCD silence releases at deadline without retry", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.ready(1); f.driver.subscribe(2); Handler.runReady();
            Handler.advanceBy(6000); check(gatt.descriptorCalls == 1, "CCCD write retried"); f.released(gatt);
        });
        test("Activity destruction releases owner and destroyed-host connect is refused", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.subscribed();
            f.app.destroy(new Activity(f.app)); Handler.runReady(); check(!gatt.closed, "another Activity closed our GATT");
            f.app.destroy(f.activity); Handler.runReady(); f.released(gatt);
            f.driver.connect("F3:27:81:36:A0:A7", 3); Handler.runReady();
            check(f.result(3, false) == 1 && f.adapter.gatts.size() == 1, "destroyed host created a GATT");
            FloorScaleGatt next = new FloorScaleGatt(new Activity(f.app), f.events::add);
            next.connect("F3:27:81:36:A0:A7", 4); Handler.runReady();
            check(f.adapter.liveCount() == 1, "new Activity cannot acquire released ownership"); next.close(5); Handler.runReady();
        });
        test("finishing Activity cannot acquire native ownership", () -> {
            Fixture f = new Fixture(); f.activity.finishing = true;
            f.driver.connect("F3:27:81:36:A0:A7", 1); Handler.runReady();
            check(f.result(1, false) == 1 && f.adapter.gatts.isEmpty() && f.app.callbacks.isEmpty(), "finishing Activity connected");
        });
        test("128 queued packets stay bounded; overflow releases and discards incomplete stream", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.subscribed();
            for (int i = 0; i < 128; i++) f.notify(gatt, new byte[512]);
            Object attempt = field(f.driver, "attempt");
            check(((ArrayDeque<?>) field(attempt, "queue")).size() == 128, "queue capacity changed");
            check(Handler.pendingCount() == 1, "notifications scheduled one task per packet");
            for (int i = 0; i < 10000; i++) f.notify(gatt, new byte[512]);
            check(((ArrayDeque<?>) field(attempt, "queue")).size() == 128 && Handler.pendingCount() == 1, "overflow is unbounded");
            Handler.runReady(); f.released(gatt); check(f.values() == 0, "overflow delivered partial data");
            check(f.events.stream().anyMatch(e -> e.contains("queue overflow")), "overflow reason absent");
            f.notify(gatt, new byte[]{1}); check(Handler.pendingCount() == 0, "released GATT kept scheduling packets");
        });
        test("non-overflow batch preserves bytes and receive time across delayed drain", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.subscribed();
            byte[] bytes = {1, 2, 3}; long before = System.currentTimeMillis(); f.notify(gatt, bytes); long after = System.currentTimeMillis();
            bytes[0] = 99; Thread.sleep(20); Handler.runReady();
            String event = f.events.stream().filter(e -> e.contains("\"type\":\"value\"")).findFirst().get();
            check(event.contains("\"hex\":\"010203\""), "notification bytes mutated before drain");
            Matcher match = Pattern.compile("\"receivedAt\":([0-9]+)").matcher(event); check(match.find(), "receive timestamp absent");
            long stamp = Long.parseLong(match.group(1)); check(stamp >= before && stamp <= after, "receive timestamp replaced by drain time");
            for (int i = 0; i < 128; i++) f.notify(gatt, new byte[]{1}); Handler.runReady();
            check(f.values() == 129 && !gatt.closed, "exact capacity should drain without overflow"); f.close(); f.released(gatt);
        });
        test("global owner rejects a second floor page; old page close cannot affect its successor", () -> {
            Fixture f = new Fixture(); BluetoothGatt first = f.ready(1);
            List<String> secondEvents = new ArrayList<>(); FloorScaleGatt second = new FloorScaleGatt(new Activity(f.app), secondEvents::add);
            second.connect("F3:27:81:36:A0:A7", 2); Handler.runReady();
            check(f.adapter.gatts.size() == 1 && !first.closed, "second page acquired concurrent GATT");
            f.close(); second.connect("F3:27:81:36:A0:A7", 3); Handler.runReady();
            BluetoothGatt successor = f.adapter.gatts.get(1); f.close();
            check(!successor.closed && f.adapter.liveCount() == 1, "old page closed successor"); second.close(4); Handler.runReady();
        });
        test("disconnect exception still closes and does not poison later connections", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.connect(1); gatt.disconnectThrows = true; f.close(); f.released(gatt);
            BluetoothGatt next = f.connect(2); check(!next.closed && f.adapter.gatts.size() == 2, "disconnect-only error poisoned process");
            f.close(); f.released(next);
        });
        test("write timeout never repeats a calibration command and ignores late acknowledgement", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.subscribed();
            f.driver.write("AA010308A6010700", 3); Handler.runReady();
            check(gatt.writeCalls == 1 && f.result(3, true) == 0, "write completed without callback");
            Handler.advanceBy(6000); check(f.result(3, false) == 1, "write timeout not returned"); f.released(gatt);
            gatt.callback.onCharacteristicWrite(gatt, gatt.lastWrite, 0); Handler.runReady();
            check(f.result(3, true) == 0 && gatt.writeCalls == 1 && gatt.closeCalls == 1, "late callback repeated or completed old write");
        });
        test("invalid command has no hardware side effect", () -> {
            Fixture f = new Fixture(); BluetoothGatt gatt = f.subscribed();
            f.driver.write("01060014000109CE", 3); Handler.runReady();
            check(gatt.writeCalls == 0 && f.result(3, false) == 1 && !gatt.closed, "arbitrary register command reached GATT"); f.close();
        });
        test("discovery rejection and missing notification characteristic release GATT", () -> {
            Fixture f = new Fixture(); BluetoothGatt first = f.connect(1); first.discoveryAccepted = false;
            first.callback.onConnectionStateChange(first, 0, BluetoothProfile.STATE_CONNECTED); Handler.runReady(); f.released(first);
            BluetoothGatt second = f.connect(2); second.callback.onServicesDiscovered(second, 0); Handler.runReady(); f.released(second);
        });
        test("connectGatt null and exception release ownership without phantom resources", () -> {
            Fixture f = new Fixture(); f.adapter.returnNull = true; f.driver.connect("F3:27:81:36:A0:A7", 1); Handler.runReady();
            check(f.result(1, false) == 1 && Handler.pendingCount() == 0 && f.app.callbacks.isEmpty(), "null connect leaked ownership");
            f.adapter.returnNull = false; f.adapter.connectThrows = true; f.driver.connect("F3:27:81:36:A0:A7", 2); Handler.runReady();
            check(f.result(2, false) == 1 && Handler.pendingCount() == 0 && f.app.callbacks.isEmpty(), "connect exception leaked ownership");
            f.adapter.connectThrows = false; BluetoothGatt current = f.connect(3); f.close(); f.released(current);
        });
        test("close failure poisons all future page owners until process restart", () -> {
            Fixture f = new Fixture(); BluetoothGatt broken = f.connect(1); broken.closeThrows = true; f.close();
            check(broken.closeCalls == 1 && !broken.closed, "close failure injection ineffective");
            FloorScaleGatt otherPage = new FloorScaleGatt(new Activity(f.app), f.events::add);
            otherPage.connect("F3:27:81:36:A0:A7", 2); f.driver.connect("F3:27:81:36:A0:A7", 3); Handler.runReady();
            check(f.adapter.gatts.size() == 1 && f.result(2, false) == 1 && f.result(3, false) == 1, "another page bypassed close failure");
            check(f.app.callbacks.isEmpty() && Handler.pendingCount() == 0, "poison path leaked timers/listeners");
        });
        System.out.println("FloorScaleGatt actual-source JVM fault replay: " + passed + " passed; Android platform/Binder/Native.js/radio behavior NOT simulated or certified.");
    }
}
