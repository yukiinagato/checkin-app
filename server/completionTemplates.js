const COMPLETION_TEMPLATES = {
  'zh-hans': {
    title: '欢迎入住！',
    subtitle: '请开始您的愉快旅程',
    cardHtml: '<p><strong>Wi-Fi SSID:</strong> Hotel Wifi<br><strong>Password:</strong> password</p>',
    extraHtml: '<p><strong>AC control</strong><br><a href="https://homeassistant.kawachinagano.ox.gy:8123/" target="_blank" rel="noopener noreferrer">https://homeassistant.kawachinagano.ox.gy:8123/</a></p><img src="./ha-login-image.png" alt="HA Login" />'
  },
  'zh-hant': {
    title: '入住愉快！',
    subtitle: '請開始您的愉快旅程',
    cardHtml: '<p><strong>Wi-Fi SSID:</strong> Hotel Wifi<br><strong>Password:</strong> password</p>',
    extraHtml: '<p><strong>AC control</strong><br><a href="https://homeassistant.kawachinagano.ox.gy:8123/" target="_blank" rel="noopener noreferrer">https://homeassistant.kawachinagano.ox.gy:8123/</a></p><img src="./ha-login-image.png" alt="HA Login" />'
  },
  en: {
    title: 'Welcome!',
    subtitle: 'Have a wonderful stay',
    cardHtml: '<p><strong>Wi-Fi SSID:</strong> Hotel Wifi<br><strong>Password:</strong> password</p>',
    extraHtml: '<p><strong>AC control</strong><br><a href="https://homeassistant.kawachinagano.ox.gy:8123/" target="_blank" rel="noopener noreferrer">https://homeassistant.kawachinagano.ox.gy:8123/</a></p><img src="./ha-login-image.png" alt="HA Login" />'
  },
  jp: {
    title: 'ようこそ！',
    subtitle: '快適なご滞在をお楽しみください',
    cardHtml: '<p><strong>Wi-Fi SSID:</strong> Hotel Wifi<br><strong>Password:</strong> password</p>',
    extraHtml: '<p><strong>AC control</strong><br><a href="https://homeassistant.kawachinagano.ox.gy:8123/" target="_blank" rel="noopener noreferrer">https://homeassistant.kawachinagano.ox.gy:8123/</a></p><img src="./ha-login-image.png" alt="HA Login" />'
  },
  ko: {
    title: '환영합니다!',
    subtitle: '즐거운 숙박 되세요',
    cardHtml: '<p><strong>Wi-Fi SSID:</strong> Hotel Wifi<br><strong>Password:</strong> password</p>',
    extraHtml: '<p><strong>AC control</strong><br><a href="https://homeassistant.kawachinagano.ox.gy:8123/" target="_blank" rel="noopener noreferrer">https://homeassistant.kawachinagano.ox.gy:8123/</a></p><img src="./ha-login-image.png" alt="HA Login" />'
  }
};

module.exports = COMPLETION_TEMPLATES;
