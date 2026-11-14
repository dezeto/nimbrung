package room

import (
	"errors"
	"testing"
)

func TestAvatarsAreOnePerPersonUntilTheyRunOut(t *testing.T) {
	r := newTestRoom(newFake())
	rina, err := r.Join("Rina", "🦊", "", false)
	if err != nil || rina.Avatar != "🦊" {
		t.Fatalf("Rina didn't get her fox: %v %v", rina, err)
	}
	if _, err := r.Join("Dimas", "🦊", "", false); !errors.Is(err, ErrAvatarTaken) {
		t.Fatalf("a second fox: got %v, want ErrAvatarTaken", err)
	}
	if host := mustJoin(t, r, "Host", true); host.Avatar == "" || host.Avatar == "🦊" {
		t.Errorf("the host should get a free face, got %q", host.Avatar)
	}
	if g, _ := r.Join("Bayu", "💩", "", false); g.Avatar == "" || g.Avatar == "💩" {
		t.Errorf("an unknown face should become a free one, got %q", g.Avatar)
	}
	for i := len(r.AvatarsTaken()); i < len(Avatars); i++ {
		mustJoin(t, r, "guest"+itoa(i), false)
	}
	if late, err := r.Join("Late", "🦊", "", false); err != nil || late.Avatar != "🦊" {
		t.Errorf("with every face taken a 13th guest still gets in: %v %v", late, err)
	}
}
