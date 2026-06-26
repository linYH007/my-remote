/** 构建 WebRTC ICE 配置，支持 STUN + 可选 TURN（跨网/NAT 穿透必需 TURN 兜底）。 */
export function getIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];

  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USER;
  const turnPass = process.env.TURN_PASS;
  if (turnUrl && turnUser && turnPass) {
    servers.push({ urls: turnUrl, username: turnUser, credential: turnPass });
  }

  return servers;
}

export function getRtcConfiguration() {
  return { iceServers: getIceServers() };
}
