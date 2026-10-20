package com.yorureader.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Region;
import android.os.Build;
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
    }

    private final Listener listener;
    private Bitmap prev, cur, next;
    /** Horizontal drag offset in px; > 0 moves the current page to the right. */
    private float offset = 0;
    private float downX, downY;
    private boolean dragging;
    private ValueAnimator animator;
    private final int touchSlop;
    private final Paint shadowPaint = new Paint();
    private int background = Color.rgb(12, 14, 19);
    /** Vertical text reads right to left: dragging right brings the next page. */
    private boolean vertical = true;
    private boolean invertTaps = false;
    private final List<Rect> holes = new ArrayList<>();
    /** The looked-up word on the current page (moves with it while sliding). */
    private final List<RectF> highlight = new ArrayList<>();
    private final Paint highlightPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    NativeReaderView(Context context, Listener listener) {
        super(context);
        this.listener = listener;
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        shadowPaint.setColor(Color.argb(70, 0, 0, 0));
    }

    void setPages(Bitmap prev, Bitmap cur, Bitmap next) {
        this.prev = prev;
        this.cur = cur;
        this.next = next;
        invalidate();
    }

    void setLook(int background, boolean vertical, boolean invertTaps) {
        this.background = background;
        this.vertical = vertical;
        this.invertTaps = invertTaps;
        invalidate();
    }

    void setHighlight(List<RectF> rects, int color) {
        highlight.clear();
        highlight.addAll(rects);
        highlightPaint.setColor(color);
        invalidate();
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
        return directionForDrag(dx) == 1 ? next : prev;
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
            case MotionEvent.ACTION_DOWN:
                if (animator != null && animator.isRunning()) animator.end();
                downX = e.getX();
                downY = e.getY();
                dragging = false;
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = e.getX() - downX;
                if (!dragging && Math.abs(dx) > touchSlop && Math.abs(dx) > Math.abs(e.getY() - downY)) {
                    dragging = true;
                    getParent().requestDisallowInterceptTouchEvent(true);
                }
                if (dragging) {
                    offset = listener.canTurn(directionForDrag(dx)) ? dx : dx / 4;
                    invalidate();
                }
                return true;
            }
            case MotionEvent.ACTION_UP: {
                if (dragging) {
                    int direction = directionForDrag(offset);
                    boolean turn = Math.abs(offset) > getWidth() * 0.18f && listener.canTurn(direction);
                    animateTo(turn ? Math.signum(offset) * getWidth() : 0, turn ? direction : 0);
                } else if (Math.abs(e.getX() - downX) < touchSlop && Math.abs(e.getY() - downY) < touchSlop) {
                    float x = e.getX();
                    // Vertical text: the left edge goes forward (the book advances to the left).
                    int leftEdge = (vertical ? 1 : -1) * (invertTaps ? -1 : 1);
                    int edge = x < getWidth() / 3f ? leftEdge : x > getWidth() * 2 / 3f ? -leftEdge : 0;
                    listener.onTap(x, e.getY(), edge);
                }
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
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
