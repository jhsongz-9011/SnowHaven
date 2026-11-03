// 키보드(←→ / A D)와 터치(화면 좌/우 절반) 입력을 -1 ~ +1 하나의 값으로 합친다.

/** 자판 배열/IME 와 무관하게 물리 키 위치로 정규화 (한글 자판에서도 E/R/A/D 가 동작) */
function keyName(e: KeyboardEvent): string {
  const c = e.code;
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  if (c === 'Space') return ' ';
  if (c.startsWith('Arrow')) return c.toLowerCase();
  return e.key.toLowerCase();
}

export class Input {
  private keys = new Set<string>();
  private touchLeft = new Set<number>();
  private touchRight = new Set<number>();
  onKey?: (key: string) => void;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const k = keyName(e);
      const combo = e.ctrlKey || e.metaKey || e.altKey; // Ctrl+R 새로고침 등은 게임 키로 쓰지 않음
      if (!combo && !this.keys.has(k)) this.onKey?.(k);
      if (!combo) this.keys.add(k);
      if (k.startsWith('arrow') || (k === ' ' && !combo)) e.preventDefault(); // Space 로 버튼이 다시 눌리는 것 방지
    });
    window.addEventListener('keyup', (e) => this.keys.delete(keyName(e)));
    window.addEventListener('blur', () => this.keys.clear());

    target.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('#gear, #action, #skip')) return;
      (e.pointerType === 'mouse' && e.button !== 0) || this.addPointer(e);
    });
    const release = (e: PointerEvent) => {
      this.touchLeft.delete(e.pointerId);
      this.touchRight.delete(e.pointerId);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  private addPointer(e: PointerEvent) {
    (e.clientX < window.innerWidth / 2 ? this.touchLeft : this.touchRight).add(e.pointerId);
  }

  /** -1 = 왼쪽, +1 = 오른쪽 */
  steer(): number {
    const left = this.keys.has('arrowleft') || this.keys.has('a') || this.touchLeft.size > 0;
    const right = this.keys.has('arrowright') || this.keys.has('d') || this.touchRight.size > 0;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }
}
