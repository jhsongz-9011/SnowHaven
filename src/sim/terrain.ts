// 지형 정의 (three.js 의존 없음). 아래쪽(내리막)은 +z 방향.

export const COURSE = {
  startZ: 15,
  finishZ: 1480,
  endZ: 1560, // 지형이 끝나는 지점
  halfWidth: 38, // 슬로프 중심에서 좌/우 한계
};

/** 슬로프 중심선의 x 좌표 (완만한 S자 곡선) */
export function centerX(z: number): number {
  return 18 * Math.sin(z * 0.012);
}

/** 지형 높이 */
export function height(x: number, z: number): number {
  const base = -0.3 * z + 8 * Math.sin(z * 0.015); // 경사가 구간마다 조금씩 달라짐
  const d = Math.abs(x - centerX(z));
  const over = Math.max(0, d - (COURSE.halfWidth - 8));
  const bank = 0.05 * over * over; // 슬로프 양옆이 솟아오른 둑
  const bumps = 0.15 * Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17); // 잔잔한 요철
  return base + bank + bumps;
}

const E = 0.5;

/** 높이의 기울기 (dh/dx, dh/dz) */
export function gradient(x: number, z: number): [number, number] {
  const gx = (height(x + E, z) - height(x - E, z)) / (2 * E);
  const gz = (height(x, z + E) - height(x, z - E)) / (2 * E);
  return [gx, gz];
}

/** 해당 지점의 내리막 방향(폴라인)과 경사 크기 */
export function fallLine(x: number, z: number): { angle: number; slope: number } {
  const [gx, gz] = gradient(x, z);
  const slope = Math.hypot(gx, gz);
  // 내리막 = 기울기의 반대 방향. 방향각 θ: (sinθ, cosθ) = (x, z)
  const angle = Math.atan2(-gx, -gz);
  return { angle, slope };
}

/** 표면 법선 (정규화) */
export function normal(x: number, z: number): [number, number, number] {
  const [gx, gz] = gradient(x, z);
  const len = Math.hypot(gx, 1, gz);
  return [-gx / len, 1 / len, -gz / len];
}
