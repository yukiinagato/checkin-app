const STEP_TEMPLATES = {
  'zh-hans': [
    { id: 'welcome', title: '欢迎入住', subtitle: 'Welcome', content: `<p>尊贵的客人，欢迎您选择入住。为了确保您能充分享受这里的宁静与便利，并保障所有住客的安全，我们准备了这份详尽的向导。请务必逐页阅读并了解。</p>` },
    { id: 'count', title: '入住人数', subtitle: 'Guest Count', content: '' },
    { id: 'registration', title: '住客信息登记', subtitle: 'Osaka Regulation', content: '' },
    { id: 'emergency', title: '安全与紧急应对', subtitle: 'Safety First', content: `
      <h3>紧急电话</h3>
      <ul>
        <li><strong>火警/急救：</strong>119</li>
        <li><strong>警察：</strong>110</li>
      </ul>
      <p>请优先拨打上述紧急电话。在确保自身安全后，前往别栋寻找管理人協助。</p>
      <p>日本电压为 100V。请勿同时开启大功率电器，以免跳闸。</p>
    ` },
    { id: 'child', title: '婴儿与儿童安全', subtitle: 'Child Protection', content: `
      <h3>浴缸溺水预防</h3>
      <p>即使极浅的水也能导致溺水。严禁婴儿单独在浴室内。用完浴缸请务必立即放干存水。</p>
      <h3>洗衣机窒息风险</h3>
      <p>滚筒洗衣机空间封闭。请严防儿童爬入。平时请务必关紧舱门，防止发生窒息事故。</p>
    ` },
    { id: 'outdoor', title: '户外边界警告', subtitle: 'Outdoor Safety', content: `
      <h3>后山警告</h3>
      <p>地势湿滑且有毒虫，进入前必须联系管理人陪同。</p>
      <h3>车库上方平台</h3>
      <p>围栏较矮。请严防坠落，严禁在边缘嬉戏。</p>
    ` },
    { id: 'water', title: '空气能热水器 (EcoCute)', subtitle: 'Hot Water System', content: `
      <h3>特別注意：时间设定</h3>
      <p>面板显示的时间被故意调快了12小时。这是为了让机器在白天气温较高时制热。请勿自行更改。</p>
      <h3>报错消除方法</h3>
      <p>在厨房面板上同时按住「時刻合わせ」与「▼」键5秒，听到「滴」声即可复位。</p>
    ` },
    { id: 'trash', title: '垃圾分类指南', subtitle: 'Waste Management', content: `
      <h3>可燃垃圾 (特别规定)</h3>
      <p>包括厨余、纸屑、塑料袋，以及宝特瓶(PET)和瓶盖。</p>
      <h3>资源垃圾 (瓶/罐)</h3>
      <p>本区域不需要特别清洗，分类放入容器。装满后打包放在室内或拿到车库大垃圾桶。</p>
    ` },
    { id: 'laundry', title: '洗烘一体机使用', subtitle: 'Laundry Guide', content: `
      <h3>Iris Ohyama 快速上手</h3>
      <ol>
        <li>放入衣物关门</li>
        <li>添加洗涤剂</li>
        <li>选择洗濯/乾燥</li>
        <li>按下スタート</li>
      </ol>
    ` },
    { id: 'rules', title: '邻里礼仪与管理', subtitle: 'Etiquette', content: `
      <p>管理人（男性）会因巡视进入公用空间。进入前会大声询问招呼。</p>
      <p>晚上 22:00 后请保持室内外静音，避免影响邻居。请在中午 12:00 前退房。</p>
    ` }
  ],
  'zh-hant': [
    { id: 'welcome', title: '歡迎入住', subtitle: 'Welcome', content: `<p>尊貴的客人，歡迎您選擇入住。為了確保您能充分享受這裡的寧靜與便利，並保障所有住客的安全，我們準備了這份詳盡的向導。請務必逐頁閱讀並了解。</p>` },
    { id: 'count', title: '入住人數', subtitle: 'Guest Count', content: '' },
    { id: 'registration', title: '住客資訊登記', subtitle: 'Osaka Regulation', content: '' },
    { id: 'emergency', title: '安全與緊急應對', subtitle: 'Safety First', content: `
      <h3>緊急電話</h3>
      <ul>
        <li><strong>火警/急救：</strong>119</li>
        <li><strong>警察：</strong>110</li>
      </ul>
      <p>請優先撥打上述緊急電話。在確保自身安全後，前往別棟尋找管理人協助。</p>
      <p>日本電壓為 100V。請勿同時開啟大功率電器，以免跳閘。</p>
    ` },
    { id: 'child', title: '嬰兒與兒童安全', subtitle: 'Child Protection', content: `
      <h3>浴缸溺水預防</h3>
      <p>即使極淺的水也能導致溺水。嚴禁嬰兒單獨在浴室內。用完浴缸請務必立即放乾存水。</p>
      <h3>洗衣機窒息風險</h3>
      <p>滾筒洗衣機空間封閉。請嚴防兒童爬入。平時請務必關緊艙門，防止發生窒息事故。</p>
    ` },
    { id: 'outdoor', title: '戶外邊界警告', subtitle: 'Outdoor Safety', content: `
      <h3>後山警告</h3>
      <p>地勢濕滑且有毒蟲，進入前必須聯繫管理人陪同。</p>
      <h3>車庫上方平台</h3>
      <p>圍欄較矮。請嚴防墜落，嚴禁在邊緣嬉戲。</p>
    ` },
    { id: 'water', title: '空氣能熱水器 (EcoCute)', subtitle: 'Hot Water System', content: `
      <h3>特別注意：時間設定</h3>
      <p>面板顯示的時間被故意調快了12小時。這是為了讓機器在白天氣溫較高時制熱。請勿自行更改。</p>
      <h3>報錯消除方法</h3>
      <p>在廚房面板上同時按住「時刻合わせ」與「▼」鍵5秒，聽到「滴」聲即可復位。</p>
    ` },
    { id: 'trash', title: '垃圾分類指南', subtitle: 'Waste Management', content: `
      <h3>可燃垃圾 (特別規定)</h3>
      <p>包括廚餘、紙屑、塑料袋，以及寶特瓶(PET)和瓶蓋。</p>
      <h3>資源垃圾 (瓶/罐)</h3>
      <p>本區域不需要特別清洗，分類放入容器。裝滿後打包放在室內或拿到車庫大垃圾桶。</p>
    ` },
    { id: 'laundry', title: '洗烘一體機使用', subtitle: 'Laundry Guide', content: `
      <h3>Iris Ohyama 快速上手</h3>
      <ol>
        <li>放入衣物關門</li>
        <li>添加洗滌劑</li>
        <li>選擇洗濯/乾燥</li>
        <li>按下スタート</li>
      </ol>
    ` },
    { id: 'rules', title: '鄰里禮儀與管理', subtitle: 'Etiquette', content: `
      <p>管理人（男性）會因巡視進入公用空間。進入前會大聲詢問招呼。</p>
      <p>晚上 22:00 後請保持室內外靜音，避免影響鄰居。請在中午 12:00 前退房。</p>
    ` }
  ],
  en: [
    { id: 'welcome', title: 'Welcome', subtitle: 'Welcome', content: `<p>Dear guest, welcome. Please read this guide for safety and convenience.</p>` },
    { id: 'count', title: 'Guest Count', subtitle: 'Guest Count', content: '' },
    { id: 'registration', title: 'Registration', subtitle: 'Osaka Regulation', content: '' },
    { id: 'emergency', title: 'Emergency', subtitle: 'Safety First', content: `
      <h3>Emergency Numbers</h3>
      <ul>
        <li><strong>Fire/Ambulance:</strong> 119</li>
        <li><strong>Police:</strong> 110</li>
      </ul>
      <p>Call emergency first, then contact the manager.</p>
      <p>Japan voltage is 100V. Avoid using multiple high-power devices at once.</p>
    ` },
    { id: 'child', title: 'Child Safety', subtitle: 'Child Protection', content: `
      <h3>Bath safety</h3>
      <p>Even shallow water can be dangerous. Never leave infants alone.</p>
      <h3>Washer safety</h3>
      <p>Keep children away from the washer drum.</p>
    ` },
    { id: 'outdoor', title: 'Outdoor Warning', subtitle: 'Outdoor Safety', content: `
      <h3>Back hill warning</h3>
      <p>Slippery terrain and poisonous insects. Contact manager.</p>
      <h3>Garage platform</h3>
      <p>Low fence. Do not play near the edge.</p>
    ` },
    { id: 'water', title: 'Hot Water System', subtitle: 'EcoCute', content: `
      <h3>Time setting notice</h3>
      <p>The panel time is set 12 hours ahead for daytime heating. Do not change it.</p>
      <h3>Error reset</h3>
      <p>Hold 「時刻合わせ」 and 「▼」 for 5 seconds.</p>
    ` },
    { id: 'trash', title: 'Waste Guide', subtitle: 'Waste Management', content: `
      <h3>Burnable trash</h3>
      <p>Food waste, paper, plastic bags, PET bottles and caps.</p>
      <h3>Recyclables</h3>
      <p>No special washing needed. Pack when full.</p>
    ` },
    { id: 'laundry', title: 'Laundry', subtitle: 'Laundry Guide', content: `
      <h3>Iris Ohyama quick guide</h3>
      <ol>
        <li>Load laundry</li>
        <li>Add detergent</li>
        <li>Select mode</li>
        <li>Press start</li>
      </ol>
    ` },
    { id: 'rules', title: 'Etiquette', subtitle: 'Etiquette', content: `
      <p>Manager (male) may enter common areas during patrol.</p>
      <p>Quiet after 22:00. Checkout before 12:00.</p>
    ` }
  ],
  jp: [
    { id: 'welcome', title: 'ようこそ', subtitle: 'Welcome', content: `<p>ようこそ。安全のためガイドをお読みください。</p>` },
    { id: 'count', title: '人数', subtitle: 'Guest Count', content: '' },
    { id: 'registration', title: '登録', subtitle: 'Osaka Regulation', content: '' },
    { id: 'emergency', title: '緊急', subtitle: 'Safety First', content: `
      <h3>緊急連絡先</h3>
      <ul>
        <li><strong>火災/救急：</strong>119</li>
        <li><strong>警察：</strong>110</li>
      </ul>
      <p>まず緊急電話、その後管理人へ連絡。</p>
      <p>電圧は100Vです。高出力家電の同時使用はお控えください。</p>
    ` },
    { id: 'child', title: '子どもの安全', subtitle: 'Child Protection', content: `
      <h3>入浴の安全</h3>
      <p>浅い水でも危険です。乳児を一人にしないでください。</p>
      <h3>洗濯機の安全</h3>
      <p>子どもが入らないように注意。</p>
    ` },
    { id: 'outdoor', title: '屋外注意', subtitle: 'Outdoor Safety', content: `
      <h3>裏山注意</h3>
      <p>滑りやすく毒虫がいます。管理人に連絡。</p>
      <h3>ガレージ上</h3>
      <p>柵が低いので注意。</p>
    ` },
    { id: 'water', title: '給湯システム', subtitle: 'EcoCute', content: `
      <h3>時間設定注意</h3>
      <p>パネル時刻は12時間進めています。変更しないでください。</p>
      <h3>エラー解除</h3>
      <p>「時刻合わせ」と「▼」を5秒押す。</p>
    ` },
    { id: 'trash', title: 'ゴミ分別', subtitle: 'Waste Management', content: `
      <h3>可燃ごみ</h3>
      <p>生ごみ、紙、ビニール袋、PETボトルとキャップ。</p>
      <h3>資源ごみ</h3>
      <p>洗浄不要。満杯になったらまとめる。</p>
    ` },
    { id: 'laundry', title: '洗濯', subtitle: 'Laundry Guide', content: `
      <h3>Iris Ohyama 使い方</h3>
      <ol>
        <li>衣類を入れる</li>
        <li>洗剤を入れる</li>
        <li>モード選択</li>
        <li>スタート</li>
      </ol>
    ` },
    { id: 'rules', title: 'マナー', subtitle: 'Etiquette', content: `
      <p>管理人（男性）が巡回で共有スペースに入ることがあります。</p>
      <p>22:00以降は静かに。12:00前にチェックアウト。</p>
    ` }
  ],
  ko: [
    { id: 'welcome', title: '환영', subtitle: 'Welcome', content: `<p>환영합니다. 안전을 위해 안내를 읽어주세요.</p>` },
    { id: 'count', title: '인원 수', subtitle: 'Guest Count', content: '' },
    { id: 'registration', title: '등록', subtitle: 'Osaka Regulation', content: '' },
    { id: 'emergency', title: '긴급', subtitle: 'Safety First', content: `
      <h3>긴급 번호</h3>
      <ul>
        <li><strong>화재/구급:</strong> 119</li>
        <li><strong>경찰:</strong> 110</li>
      </ul>
      <p>먼저 긴급전화, 이후 관리자에게 연락.</p>
      <p>일본 전압은 100V입니다.</p>
    ` },
    { id: 'child', title: '아동 안전', subtitle: 'Child Protection', content: `
      <h3>목욕 안전</h3>
      <p>얕은 물도 위험합니다. 영아를 혼자 두지 마세요.</p>
      <h3>세탁기 안전</h3>
      <p>아이들이 들어가지 않게 주의하세요.</p>
    ` },
    { id: 'outdoor', title: '야외 경고', subtitle: 'Outdoor Safety', content: `
      <h3>뒷산 경고</h3>
      <p>미끄럽고 독충이 있습니다. 관리자 연락 필요.</p>
      <h3>차고 위</h3>
      <p>난간이 낮습니다. 가장자리 주의.</p>
    ` },
    { id: 'water', title: '온수 시스템', subtitle: 'EcoCute', content: `
      <h3>시간 설정 주의</h3>
      <p>패널 시간이 12시간 빠르게 설정되어 있습니다. 변경하지 마세요.</p>
      <h3>오류 초기화</h3>
      <p>「時刻合わせ」와「▼」를 5초간 누르세요.</p>
    ` },
    { id: 'trash', title: '쓰레기 분리', subtitle: 'Waste Management', content: `
      <h3>가연성 쓰레기</h3>
      <p>음식물, 종이, 비닐, PET병과 뚜껑.</p>
      <h3>재활용</h3>
      <p>세척 불필요. 가득 차면 묶어주세요.</p>
    ` },
    { id: 'laundry', title: '세탁', subtitle: 'Laundry Guide', content: `
      <h3>Iris Ohyama 사용법</h3>
      <ol>
        <li>세탁물 넣기</li>
        <li>세제 넣기</li>
        <li>모드 선택</li>
        <li>시작</li>
      </ol>
    ` },
    { id: 'rules', title: '에티켓', subtitle: 'Etiquette', content: `
      <p>관리자(남성)가 순찰 시 공용 공간에 들어올 수 있습니다.</p>
      <p>22:00 이후 정숙. 12:00 전에 체크아웃.</p>
    ` }
  ]
};

module.exports = STEP_TEMPLATES;
