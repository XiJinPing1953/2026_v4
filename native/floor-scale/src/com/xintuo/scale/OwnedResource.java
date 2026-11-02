package com.xintuo.scale;

/** One connection attempt owns one resource, including failed and cancelled attempts. */
public final class OwnedResource<T> {
    public interface Releaser<T> { void release(T resource) throws Exception; }
    private final Releaser<T> releaser;
    private T resource;
    private boolean released;
    private boolean assigned;

    public OwnedResource(Releaser<T> releaser) { this.releaser = releaser; }
    public void assign(T value) throws Exception {
        if (assigned) throw new IllegalStateException("resource already assigned");
        assigned = true;
        if (released) { if (value != null) releaser.release(value); }
        else resource = value;
    }
    public T get() { return released ? null : resource; }
    public boolean isReleased() { return released; }
    public void release() throws Exception {
        if (released) return;
        released = true;
        T value = resource;
        resource = null;
        if (value != null) releaser.release(value);
    }
}
