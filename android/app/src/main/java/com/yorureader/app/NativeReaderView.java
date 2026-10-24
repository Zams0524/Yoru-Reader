package com.yorureader.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Region;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.animation.DecelerateInterpolator;

import java.util.ArrayList;
import java.util.List;

/**
 * Full-screen page view of the native reader, drawn above the WebView. Shows pre-rendered page
 * bitmaps and slides between them (vertical Japanese: the next page comes in from the left, like
 * ReadEra). Holes are screen areas where the WebView below (Yoru's bars and panels) shows through
 * and gets the touches.
 */
final class NativeReaderView extends View {
    interface Listener {
        void onSized(int width, int height);
        /** direction: 1 = next page, -1 = previous page. */
        boolean canTurn(int direction);
        void onTurned(int direction);
        /**
         * A tap (not a drag). edgeDirection: the page the tap zone turns to (1 next, -1 previous),
         * or 0 in the middle of the page; the listener decides (a word under the finger wins).
         */
        void onTap(float x, float y, int edgeDirection);
        /** A long press without moving: true if it started a text selection (a letter is under it). */
        boolean onLongPress(float x, float y);
        /**
         * The finger moves while selecting: handle 0 extends the selection begun by the long press,
         * 1 moves its start, 2 its end. x, y: the point the handle (or finger) points at.
         */
        void onSelectionDrag(float x, float y, int handle);
        /** The finger that was selecting is lifted. */
        void onSelectionDragEnd();
    }

    private final Listener listener;
    private Bitmap prev, cur, next;
    /** Horizontal drag offset in px; > 0 moves the current page to the right. */
    private float offset = 0;
    private float downX, downY;
    private boolean dragging;
    private ValueAnimator animator;
    /** A turn asked for while its page was still being drawn: done as soon as the page arrives. */
    private int pendingTurn = 0;
    private final int touchSlop;
    private final Paint shadowPaint = new Paint();
    private int background = Color.rgb(12, 14, 19);
    /** Vertical text reads right to left: dragging right brings the next page. */
    private boolean vertical = true;
    private boolean invertTaps = false;
    private boolean kindleTaps = false;
    private final List<Rect> holes = new ArrayList<>();
    /** The looked-up word on the current page (moves with it while sliding). */
    private final List<RectF> highlight = new ArrayList<>();
    private final Paint highlightPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dimPaint = new Paint();
    /** The text selection on the current page (long press), one box per line, and its two handles. */
    private final List<RectF> selection = new ArrayList<>();
    private final Paint selectionPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint handlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private PointF startHandle, endHandle;
    /** Where each handle's knob is drawn: the letter edge it marks plus this offset (px). */
    private PointF startKnob, endKnob;
    /** Selecting with the finger down: -1 no, 0 extending after the long press, 1 start handle, 2 end handle. */
    private int selectingWith = -1;
    /** Offset from the finger to the letter edge the dragged handle marks (the finger would hide it). */
    private float grabDx, grabDy;
    private boolean longPressed;
    private final Runnable longPress = this::onLongPressTimeout;

    NativeReaderView(Context context, Listener listener) {
        super(context);
        this.listener = listener;
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        shadowPaint.setColor(Color.argb(70, 0, 0, 0));
    }

    /** The finger stayed still for the long-press time: a text selection starts if a letter is under it. */
    private void onLongPressTimeout() {
        if (dragging || isAnimating()) return;
        if (listener.onLongPress(downX, downY)) {
            longPressed = true;
            selectingWith = 0;
            grabDx = grabDy = 0;
            performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
            getParent().requestDisallowInterceptTouchEvent(true);
        }
    }

    void setPages(Bitmap prev, Bitmap cur, Bitmap next) {
        this.prev = prev;
        this.cur = cur;
        this.next = next;
        invalidate();
        if (pendingTurn != 0 && incomingFor(pendingTurn) != null) {
            int direction = pendingTurn;
            pendingTurn = 0;
            turn(direction);
        }
    }

    private Bitmap incomingFor(int direction) {
        return direction == 1 ? next : prev;
    }

    void setLook(int background, boolean vertical, boolean invertTaps, boolean kindleTaps, int brightness) {
        this.background = background;
        // The reader's brightness setting: a black veil over the page (not over Yoru's bars).
        dimPaint.setColor(Color.argb(Math.round((100 - brightness) * 2.55f), 0, 0, 0));
        this.vertical = vertical;
        this.invertTaps = invertTaps;
        this.kindleTaps = kindleTaps;
        invalidate();
    }

    void setHighlight(List<RectF> rects, int color) {
        highlight.clear();
        highlight.addAll(rects);
        highlightPaint.setColor(color);
        invalidate();
    }

    /**
     * The selection's line boxes and the letter edges its handles mark (null hides them).
     * vertical: the knobs go above the first letter and below the last one; otherwise below both.
     */
    void setSelection(List<RectF> rects, PointF start, PointF end, int color, int handleColor) {
        selection.clear();
        selection.addAll(rects);
        selectionPaint.setColor(color);
        handlePaint.setColor(handleColor);
        startHandle = start;
        endHandle = end;
        float knob = 11 * getResources().getDisplayMetrics().density;
        startKnob = start == null ? null : vertical ? new PointF(start.x, start.y - knob) : new PointF(start.x - knob * 0.6f, start.y + knob);
        endKnob = end == null ? null : vertical ? new PointF(end.x, end.y + knob) : new PointF(end.x + knob * 0.6f, end.y + knob);
        invalidate();
    }

    boolean hasSelection() {
        return !selection.isEmpty();
    }

    /** Handle whose knob is under the point: 1 start, 2 end, 0 none. */
    private int handleAt(float x, float y) {
        float reach = 28 * getResources().getDisplayMetrics().density;
        float ds = startKnob == null ? Float.MAX_VALUE : (float) Math.hypot(x - startKnob.x, y - startKnob.y);
        float de = endKnob == null ? Float.MAX_VALUE : (float) Math.hypot(x - endKnob.x, y - endKnob.y);
        if (Math.min(ds, de) > reach) return 0;
        return ds <= de ? 1 : 2;
    }

    void setHoles(List<Rect> rects) {
        holes.clear();
        holes.addAll(rects);
        invalidate();
    }

    boolean isAnimating() {
        return animator != null && animator.isRunning();
    }

    /** Page that comes in when the current one moves right (sign 1) or left (sign -1). */
    private int directionForDrag(float dx) {
        int sign = dx > 0 ? 1 : -1;
        return vertical ? sign : -sign;
    }

    private Bitmap incoming(float dx) {
        return incomingFor(directionForDrag(dx));
    }

    /** The page can turn that way and its bitmap is ready (sliding in an empty page shows only the background). */
    private boolean canSlide(int direction) {
        return listener.canTurn(direction) && incomingFor(direction) != null;
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w > 0 && h > 0) listener.onSized(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int w = getWidth();
        canvas.save();
        for (Rect hole : holes) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) canvas.clipOutRect(hole);
            else canvas.clipRect(hole, Region.Op.DIFFERENCE);
        }
        canvas.drawColor(background);
        if (cur != null) canvas.drawBitmap(cur, offset, 0, null);
        if (!highlight.isEmpty()) {
            float radius = 4 * getResources().getDisplayMetrics().density;
            canvas.save();
            canvas.translate(offset, 0);
            for (RectF r : highlight) canvas.drawRoundRect(r, radius, radius, highlightPaint);
            canvas.restore();
        }
        if (!selection.isEmpty() && offset == 0) {
            float radius = 3 * getResources().getDisplayMetrics().density;
            for (RectF r : selection) canvas.drawRoundRect(r, radius, radius, selectionPaint);
            float knob = 7 * getResources().getDisplayMetrics().density;
            float stem = 1.5f * getResources().getDisplayMetrics().density;
            if (startHandle != null && startKnob != null) {
                canvas.drawRect(Math.min(startHandle.x, startKnob.x) - stem, Math.min(startHandle.y, startKnob.y) - stem,
                    Math.max(startHandle.x, startKnob.x) + stem, Math.max(startHandle.y, startKnob.y) + stem, handlePaint);
                canvas.drawCircle(startKnob.x, startKnob.y, knob, handlePaint);
            }
            if (endHandle != null && endKnob != null) {
                canvas.drawRect(Math.min(endHandle.x, endKnob.x) - stem, Math.min(endHandle.y, endKnob.y) - stem,
                    Math.max(endHandle.x, endKnob.x) + stem, Math.max(endHandle.y, endKnob.y) + stem, handlePaint);
                canvas.drawCircle(endKnob.x, endKnob.y, knob, handlePaint);
            }
        }
        Bitmap other = offset != 0 ? incoming(offset) : null;
        if (other != null) {
            if (offset > 0) {
                canvas.drawBitmap(other, offset - w, 0, null);
                canvas.drawRect(offset - 4, 0, offset, getHeight(), shadowPaint);
            } else {
                canvas.drawBitmap(other, w + offset, 0, null);
                canvas.drawRect(w + offset, 0, w + offset + 4, getHeight(), shadowPaint);
            }
        }
        if (Color.alpha(dimPaint.getColor()) > 0) canvas.drawRect(0, 0, getWidth(), getHeight(), dimPaint);
        canvas.restore();
    }

    private boolean inHole(float x, float y) {
        for (Rect hole : holes) if (hole.contains((int) x, (int) y)) return true;
        return false;
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        // Touches in a hole go to the WebView below (not handling ACTION_DOWN passes the gesture on).
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN && inHole(e.getX(), e.getY())) return false;
        return super.dispatchTouchEvent(e);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                if (animator != null && animator.isRunning()) animator.end();
                pendingTurn = 0;
                downX = e.getX();
                downY = e.getY();
                dragging = false;
                longPressed = false;
                selectingWith = -1;
                removeCallbacks(longPress);
                int handle = selection.isEmpty() ? 0 : handleAt(downX, downY);
                if (handle != 0) {
                    // Dragging a handle: it points at the letter edge, not at the finger.
                    PointF edge = handle == 1 ? startHandle : endHandle;
                    selectingWith = handle;
                    grabDx = edge.x - downX;
                    grabDy = edge.y - downY;
                    getParent().requestDisallowInterceptTouchEvent(true);
                    return true;
                }
                postDelayed(longPress, ViewConfiguration.getLongPressTimeout());
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (selectingWith >= 0) {
                    listener.onSelectionDrag(e.getX() + grabDx, e.getY() + grabDy, selectingWith);
                    return true;
                }
                float dx = e.getX() - downX;
                if (Math.abs(dx) > touchSlop || Math.abs(e.getY() - downY) > touchSlop) removeCallbacks(longPress);
                if (!dragging && Math.abs(dx) > touchSlop && Math.abs(dx) > Math.abs(e.getY() - downY)) {
                    dragging = true;
                    getParent().requestDisallowInterceptTouchEvent(true);
                }
                if (dragging) {
                    offset = canSlide(directionForDrag(dx)) ? dx : dx / 4;
                    invalidate();
                }
                return true;
            }
            case MotionEvent.ACTION_UP: {
                removeCallbacks(longPress);
                if (selectingWith >= 0 || longPressed) {
                    selectingWith = -1;
                    longPressed = false;
                    listener.onSelectionDragEnd();
                    return true;
                }
                if (dragging) {
                    int direction = directionForDrag(offset);
                    boolean turn = Math.abs(offset) > getWidth() * 0.18f && canSlide(direction);
                    animateTo(turn ? Math.signum(offset) * getWidth() : 0, turn ? direction : 0);
                } else if (Math.abs(e.getX() - downX) < touchSlop && Math.abs(e.getY() - downY) < touchSlop) {
                    float x = e.getX();
                    int edge;
                    if (kindleTaps) {
                        // Kindle mode: left 20% back, right 80% forward (no vertical correction).
                        edge = (x < getWidth() * 0.20f ? -1 : 1) * (invertTaps ? -1 : 1);
                    } else {
                        // Edge mode: left/right thirds advance, center shows/hides bars.
                        int leftEdge = (vertical ? 1 : -1) * (invertTaps ? -1 : 1);
                        edge = x < getWidth() / 3f ? leftEdge : x > getWidth() * 2 / 3f ? -leftEdge : 0;
                    }
                    listener.onTap(x, e.getY(), edge);
                }
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                removeCallbacks(longPress);
                if (selectingWith >= 0 || longPressed) listener.onSelectionDragEnd();
                selectingWith = -1;
                longPressed = false;
                if (dragging) animateTo(0, 0);
                dragging = false;
                return true;
            default:
                return true;
        }
    }

    /** Slides to the next (1) or previous (-1) page. */
    void turn(int direction) {
        if (isAnimating() || !listener.canTurn(direction)) return;
        if (incomingFor(direction) == null) {
            pendingTurn = direction;
            return;
        }
        pendingTurn = 0;
        // The current page leaves towards where the incoming page is not: vertical next = to the right.
        float sign = vertical ? direction : -direction;
        animateTo(sign * getWidth(), direction);
    }

    private void animateTo(float target, int direction) {
        animator = ValueAnimator.ofFloat(offset, target);
        float distance = Math.abs(target - offset) / Math.max(1, getWidth());
        animator.setDuration((long) (120 + 140 * Math.min(1f, distance)));
        animator.setInterpolator(new DecelerateInterpolator(1.6f));
        animator.addUpdateListener(a -> { offset = (float) a.getAnimatedValue(); invalidate(); });
        animator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                offset = 0;
                if (direction != 0) listener.onTurned(direction);
                invalidate();
            }
        });
        animator.start();
    }
}
