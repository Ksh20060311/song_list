require('dotenv').config();
const express = require('express');
const axios = require('axios');
const io = require('socket.io-client'); // v2는 require 결과 자체가 함수임
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.CHZZK_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

const OPEN_API = 'https://openapi.chzzk.naver.com';

// "!제목" 또는 "!(제목)" 둘 다 인식
const TITLE_PATTERN = /^!\s*\(?(.+?)\)?$/;

let accessToken = null;
const list = []; // { nickname, title, time } - 최신순으로 앞에 쌓임

app.use(express.static(path.join(__dirname, 'public')));

// 1) 로그인 시작
app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(8).toString('hex');
  const url =
    `https://chzzk.naver.com/account-interlock?clientId=${encodeURIComponent(CLIENT_ID)}` +
    `&redirectUri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
  res.redirect(url);
});

// 2) 로그인 콜백 -> 토큰 발급 -> 채팅 구독 시작
app.get('/auth/callback', async (req, res) => {
  try {
    const { data } = await axios.post(`${OPEN_API}/auth/v1/token`, {
      grantType: 'authorization_code',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: req.query.code,
      state: req.query.state,
    });
    accessToken = data.content.accessToken;
    await startChat();
    res.redirect('/');
  } catch (e) {
    res.status(500).send('로그인 실패: ' + JSON.stringify(e.response?.data || e.message));
  }
});

// 3) 채팅 세션 연결 + 구독
async function startChat() {
  const { data } = await axios.get(`${OPEN_API}/open/v1/sessions/auth`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const socket = io(data.content.url, { transports: ['websocket'] });

  socket.on('SYSTEM', async (raw) => {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (msg.type === 'connected') {
      await axios.post(
        `${OPEN_API}/open/v1/sessions/events/subscribe/chat`,
        null,
        {
          params: { sessionKey: msg.data.sessionKey },
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      console.log('채팅 구독 시작됨');
    }
  });

  // 4) 채팅 도착 -> "!제목" 패턴이면 목록에 추가
  socket.on('CHAT', (raw) => {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const content = (msg.content || '').trim();
    const match = content.match(TITLE_PATTERN);
    if (match) {
      list.push({
        nickname: msg.profile?.nickname || '알 수 없음',
        title: match[1].trim(),
        time: new Date().toLocaleTimeString('ko-KR'),
      });
    }
  });
}

// 5) 화면이 2초마다 이 API를 호출해서 목록을 가져감
app.get('/api/list', (req, res) => {
  res.json({ loggedIn: !!accessToken, list });
});

// 6) 맨 위(가장 오래된) 곡 하나 제거 - 키보드 버튼에서 호출
app.post('/api/next', (req, res) => {
  list.shift();
  res.json({ loggedIn: !!accessToken, list });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT} 실행 중`));
