package room

import "time"

// limiter is a tiny per-key sliding-window rate limiter. It is not safe for
// concurrent use on its own; Room guards it with its mutex.
type limiter struct {
	window time.Duration
	max    int
	hits   map[string][]time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{window: window, max: max, hits: map[string][]time.Time{}}
}

// allow records a hit for key and reports whether it was within the limit.
func (l *limiter) allow(key string, now time.Time) bool {
	if l.max <= 0 {
		return true
	}
	cutoff := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

// remaining reports how many hits key has left in the current window.
func (l *limiter) remaining(key string, now time.Time) int {
	if l.max <= 0 {
		return 1 << 30
	}
	cutoff := now.Add(-l.window)
	n := 0
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			n++
		}
	}
	if r := l.max - n; r > 0 {
		return r
	}
	return 0
}
