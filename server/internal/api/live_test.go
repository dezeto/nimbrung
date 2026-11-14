package api

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReactionsAndCommentsAnswerWithTheRightStatus(t *testing.T) {
	cases := []struct {
		name, path, body string
		times            int // the status is the last call's
		joined           bool
		want             int
	}{
		{"a reaction", "/api/reactions", `{"reaction":"fire"}`, 1, true, http.StatusNoContent},
		{"a reaction before joining", "/api/reactions", `{"reaction":"fire"}`, 1, false, http.StatusUnauthorized},
		{"a reaction that isn't one of the six", "/api/reactions", `{"reaction":"skull"}`, 1, true, http.StatusBadRequest},
		{"the 21st reaction in 5 seconds", "/api/reactions", `{"reaction":"fire"}`, 21, true, http.StatusTooManyRequests},
		{"a comment", "/api/comments", `{"text":"what a drop"}`, 1, true, http.StatusNoContent},
		{"an 80-emoji comment", "/api/comments", `{"text":"` + strings.Repeat("🔥", 80) + `"}`, 1, true, http.StatusNoContent},
		{"an 81-emoji comment", "/api/comments", `{"text":"` + strings.Repeat("🔥", 81) + `"}`, 1, true, http.StatusBadRequest},
		{"a blank comment", "/api/comments", `{"text":"  "}`, 1, true, http.StatusBadRequest},
		{"a comment that isn't JSON", "/api/comments", `what a drop`, 1, true, http.StatusBadRequest},
		{"the 6th comment in 30 seconds", "/api/comments", `{"text":"again"}`, 6, true, http.StatusTooManyRequests},
	}
	for _, c := range cases {
		s := newTestServer()
		var cookies []*http.Cookie
		if c.joined {
			cookies = call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`).Result().Cookies()
		}
		var rec *httptest.ResponseRecorder
		for range c.times {
			rec = call(s, http.MethodPost, c.path, c.body, cookies...)
		}
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body)
		}
	}
}

func TestEventsStreamPushesReactionsAndFeedAsTheirOwnEvents(t *testing.T) {
	s := newTestServer()
	srv := httptest.NewServer(s)
	defer srv.Close()
	cookies := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`).Result().Cookies()

	resp, err := http.Get(srv.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	events := make(chan [2]string, 16) // event name, data
	go func() {
		name := ""
		for sc := bufio.NewScanner(resp.Body); sc.Scan(); {
			if v, ok := strings.CutPrefix(sc.Text(), "event: "); ok {
				name = v
			}
			if v, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
				events <- [2]string{name, v}
			}
		}
	}()
	<-events // the snapshot sent on connect

	call(s, http.MethodPost, "/api/reactions", `{"reaction":"fire"}`, cookies...)
	call(s, http.MethodPost, "/api/comments", `{"text":"what a drop"}`, cookies...)

	want := map[string]string{
		reactionEvent: `"reaction":"fire","guestId":`,
		feedEvent:     `"kind":"comment",`,
	}
	timeout := time.After(2 * time.Second)
	for len(want) > 0 {
		select {
		case ev := <-events:
			if fragment, ok := want[ev[0]]; ok {
				if !strings.Contains(ev[1], fragment) || !strings.Contains(ev[1], `"name":"Rina"`) {
					t.Errorf("%s event = %s, want Rina's and %s", ev[0], ev[1], fragment)
				}
				delete(want, ev[0])
			}
		case <-timeout:
			t.Fatalf("no %v event within 2s", want)
		}
	}
}
