const STEP_TEMPLATES = {
  'zh-hans': [
    { id: 'welcome', category: 'checkin', title: '欢迎入住', subtitle: 'Welcome', type: 'builtin', content: `<p>尊贵的客人，欢迎您选择入住。为了确保您能充分享受这里的宁静与便利，并保障所有住客的安全，我们准备了这份详尽的向导。请务必逐页阅读并了解。</p>` },
    { id: 'count', category: 'checkin', title: '入住人数', subtitle: 'Guest Count', type: 'builtin', content: '' },
    { id: 'stayDuration', category: 'checkin', title: '入住时长', subtitle: 'Stay Duration', type: 'builtin', content: '' },
    { id: 'privacy', category: 'checkin', title: '个人信息保护', subtitle: 'Privacy Notice', type: 'builtin', content: `<p><strong>个人信息保护声明</strong></p><p>依据日本《住宅宿泊事业法》（2017年第65号）第8条及《旅馆业法施行规则》第4条，本设施须依法采集以下信息并建立住宿者名册。</p><p><strong>采集项目：</strong>姓名、住所（日本居民）、国籍、护照号码、护照照片</p><p><strong>使用目的：</strong>仅用于法定住宿者名册的记录与保管，不作其他任何用途。</p><p><strong>保存期限：</strong>依据《旅馆业法施行规则》第4条第1项，自退房日起保存 <strong>3年</strong>。</p><p><strong>管理责任人：</strong>本设施管理员</p><p><strong>第三方提供：</strong>除法令规定的行政机关（警察、行政厅等）依职权调取外，不向任何第三方提供。</p><p>依据《个人信息保护法》，您有权就本人信息的查阅、更正及删除向管理员提出申请。</p>` },
    { id: 'registration', category: 'checkin', title: '住客信息登记', subtitle: 'Osaka Regulation', type: 'builtin', content: '' },
    {
      id: 'safety', category: 'guide', title: '安全', subtitle: 'Safety', type: 'group', content: '',
      children: [
        { id: 'emergency', title: '紧急情况', enabled: true, content: `<h3>紧急电话</h3><ul><li><strong>火警/急救：</strong>119</li><li><strong>警察：</strong>110</li></ul><p>请优先拨打上述紧急电话。在确保自身安全后，前往别栋寻找管理人协助。</p>` },
        { id: 'child', title: '儿童与浴缸安全', enabled: true, content: `<h3>浴缸溺水预防</h3><p>即使极浅的水也能导致溺水。严禁婴儿单独在浴室内。用完浴缸请务必立即放干存水。</p><h3>窗边与楼梯</h3><p>窗边、楼梯等区域请勿让儿童单独停留。浴室地面湿滑，请看护儿童防止跌倒。</p>` }
      ]
    },
    { id: 'trash', category: 'guide', title: '垃圾分类指南', subtitle: 'Waste Management', type: 'builtin', content: `<h3>可燃垃圾 (特别规定)</h3><p>包括厨余、纸屑、塑料袋，以及宝特瓶(PET)和瓶盖。</p><h3>资源垃圾 (瓶/罐)</h3><p>本区域不需要特别清洗，分类放入容器。装满后打包放在室内或拿到车库大垃圾桶。</p>` },
    { id: 'rules', category: 'guide', title: '邻里礼仪与管理', subtitle: 'Etiquette', type: 'builtin', content: `<p>管理人（男性）会因巡视进入公用空间。进入前会大声询问招呼。</p><p>晚上 22:00 后请保持室内外静音，避免影响邻居。请在中午 12:00 前退房。</p>` }
  ],

  'zh-hant': [
    { id: 'welcome', category: 'checkin', title: '歡迎入住', subtitle: 'Welcome', type: 'builtin', content: `<p>尊貴的客人，歡迎您選擇入住。為了確保您能充分享受這裡的寧靜與便利，並保障所有住客的安全，我們準備了這份詳盡的向導。請務必逐頁閱讀並了解。</p>` },
    { id: 'count', category: 'checkin', title: '入住人數', subtitle: 'Guest Count', type: 'builtin', content: '' },
    { id: 'stayDuration', category: 'checkin', title: '入住時長', subtitle: 'Stay Duration', type: 'builtin', content: '' },
    { id: 'privacy', category: 'checkin', title: '個人資訊保護', subtitle: 'Privacy Notice', type: 'builtin', content: `<p><strong>個人資訊保護聲明</strong></p><p>依據日本《住宅宿泊事業法》（2017年第65號）第8條及《旅館業法施行規則》第4條規定，本設施須依法蒐集以下資訊並建立住宿者名冊。</p><p><strong>蒐集項目：</strong>姓名、住所（日本居民）、國籍、護照號碼、護照照片</p><p><strong>使用目的：</strong>僅用於法定住宿者名冊之記錄與保管，不作其他任何用途。</p><p><strong>保存期限：</strong>依據《旅館業法施行規則》第4條第1項，自退房日起保存 <strong>3年</strong>。</p><p><strong>管理負責人：</strong>本設施管理員</p><p><strong>第三方提供：</strong>除法令規定之行政機關（警察、行政廳等）依職權調取外，不向任何第三方提供。</p><p>依據《個人資訊保護法》，您有權就本人資訊之查閱、更正及刪除向管理員提出申請。</p>` },
    { id: 'registration', category: 'checkin', title: '住客資訊登記', subtitle: 'Osaka Regulation', type: 'builtin', content: '' },
    {
      id: 'safety', category: 'guide', title: '安全', subtitle: 'Safety', type: 'group', content: '',
      children: [
        { id: 'emergency', title: '緊急情況', enabled: true, content: `<h3>緊急電話</h3><ul><li><strong>火警/急救：</strong>119</li><li><strong>警察：</strong>110</li></ul><p>請優先撥打上述緊急電話。在確保自身安全後，前往別棟尋找管理人協助。</p>` },
        { id: 'child', title: '兒童與浴缸安全', enabled: true, content: `<h3>浴缸溺水預防</h3><p>即使極淺的水也能導致溺水。嚴禁嬰兒單獨在浴室內。用完浴缸請務必立即放乾存水。</p><h3>窗邊與樓梯</h3><p>請勿讓兒童獨自在窗邊或樓梯附近活動。浴室地面濕滑，請加強看護。</p>` }
      ]
    },
    { id: 'trash', category: 'guide', title: '垃圾分類指南', subtitle: 'Waste Management', type: 'builtin', content: `<h3>可燃垃圾 (特別規定)</h3><p>包括廚餘、紙屑、塑料袋，以及寶特瓶(PET)和瓶蓋。</p><h3>資源垃圾 (瓶/罐)</h3><p>本區域不需要特別清洗，分類放入容器。裝滿後打包放在室內或拿到車庫大垃圾桶。</p>` },
    { id: 'rules', category: 'guide', title: '鄰里禮儀與管理', subtitle: 'Etiquette', type: 'builtin', content: `<p>管理人（男性）會因巡視進入公用空間。進入前會大聲詢問招呼。</p><p>晚上 22:00 後請保持室內外靜音，避免影響鄰居。請在中午 12:00 前退房。</p>` }
  ],

  en: [
    { id: 'welcome', category: 'checkin', title: 'Welcome', subtitle: 'Welcome', type: 'builtin', content: `<p>Dear guest, welcome. Please read this guide for safety and convenience during your stay.</p>` },
    { id: 'count', category: 'checkin', title: 'Guest Count', subtitle: 'Guest Count', type: 'builtin', content: '' },
    { id: 'stayDuration', category: 'checkin', title: 'Stay Duration', subtitle: 'Stay Duration', type: 'builtin', content: '' },
    { id: 'privacy', category: 'checkin', title: 'Privacy Notice', subtitle: 'Personal Data', type: 'builtin', content: `<p><strong>Privacy Notice — Personal Information</strong></p><p>Under Japan's Act on Accommodation Business Using Private Residences (Minpaku Act, 2017, Art. 8) and the Enforcement Regulations of the Inn Business Act (Art. 4), this accommodation is legally required to record your personal details in the guest register (宿泊者名簿).</p><p><strong>Information collected:</strong> Name, address (Japan residents), nationality, passport number, passport photograph</p><p><strong>Purpose of use:</strong> Legally mandated guest register only. Your information will not be used for any other purpose.</p><p><strong>Retention period:</strong> <strong>3 years</strong> from your checkout date, as required by Inn Business Act Enforcement Regulations Art. 4(1).</p><p><strong>Data controller:</strong> The property manager of this accommodation.</p><p><strong>Third-party disclosure:</strong> Your information will not be disclosed to any third party except where required by law (e.g., official requests from police or government authorities acting under statutory authority).</p><p>Under Japan's Act on the Protection of Personal Information (APPI), you have the right to request access, correction, or deletion of your personal data. Please contact the property manager.</p>` },
    { id: 'registration', category: 'checkin', title: 'Registration', subtitle: 'Osaka Regulation', type: 'builtin', content: '' },
    {
      id: 'safety', category: 'guide', title: 'Safety', subtitle: 'Safety', type: 'group', content: '',
      children: [
        { id: 'emergency', title: 'Emergency', enabled: true, content: `<h3>Emergency Numbers</h3><ul><li><strong>Fire/Ambulance:</strong> 119</li><li><strong>Police:</strong> 110</li></ul><p>Call emergency first, then contact the manager in the other building.</p>` },
        { id: 'child', title: 'Child & Bathtub Safety', enabled: true, content: `<h3>Bathtub drowning prevention</h3><p>Even shallow water is dangerous. Never leave infants alone in the bathroom. Always drain the tub immediately after use.</p><h3>Windows & stairs</h3><p>Do not leave children unattended near windows or stairs. Bathroom floors can be slippery — supervise children at all times.</p>` }
      ]
    },
    { id: 'trash', category: 'guide', title: 'Waste Guide', subtitle: 'Waste Management', type: 'builtin', content: `<h3>Burnable trash</h3><p>Food waste, paper, plastic bags, PET bottles and caps.</p><h3>Recyclables</h3><p>No special washing needed. Sort bottles/cans into the containers and pack them when full.</p>` },
    { id: 'rules', category: 'guide', title: 'Etiquette', subtitle: 'Etiquette', type: 'builtin', content: `<p>The manager (male) may enter common areas during patrols. He will announce himself before entering.</p><p>Please keep quiet after 22:00. Check out before 12:00.</p>` }
  ],

  jp: [
    { id: 'welcome', category: 'checkin', title: 'ようこそ', subtitle: 'Welcome', type: 'builtin', content: `<p>ようこそ。安全で快適なご滞在のため、各ステップの案内をご確認ください。</p>` },
    { id: 'count', category: 'checkin', title: '人数', subtitle: 'Guest Count', type: 'builtin', content: '' },
    { id: 'stayDuration', category: 'checkin', title: '宿泊日数', subtitle: 'Stay Duration', type: 'builtin', content: '' },
    { id: 'privacy', category: 'checkin', title: '個人情報について', subtitle: 'Privacy Notice', type: 'builtin', content: `<p><strong>個人情報の取り扱いについて</strong></p><p>本施設は、住宅宿泊事業法（平成29年法律第65号）第8条および旅館業法施行規則（昭和23年厚生省令第28号）第4条に基づき、宿泊者名簿への記録を目的として、以下の個人情報を収集いたします。</p><p><strong>収集する情報：</strong>氏名、住所（国内在住者）、国籍、旅券番号、旅券の写し（写真）</p><p><strong>利用目的：</strong>法令に基づく宿泊者名簿の記録・保管のみ。他の目的には一切使用いたしません。</p><p><strong>保存期間：</strong>旅館業法施行規則第4条第1項に基づき、チェックアウト日から <strong>3年間</strong></p><p><strong>管理責任者：</strong>本施設の管理者</p><p><strong>第三者提供：</strong>法令に基づく行政機関（警察・保健所等）による職権上の照会・調査を除き、第三者へは一切提供いたしません。</p><p>個人情報の保護に関する法律（個人情報保護法）に基づき、ご自身の情報に関する開示・訂正・利用停止・削除のご請求は、管理者までお申し出ください。</p>` },
    { id: 'registration', category: 'checkin', title: '登録', subtitle: 'Osaka Regulation', type: 'builtin', content: '' },
    {
      id: 'safety', category: 'guide', title: '安全', subtitle: 'Safety', type: 'group', content: '',
      children: [
        { id: 'emergency', title: '緊急', enabled: true, content: `<h3>緊急連絡先</h3><ul><li><strong>火災/救急：</strong>119</li><li><strong>警察：</strong>110</li></ul><p>まず緊急電話をかけ、安全を確認してから管理人へ連絡してください。</p>` },
        { id: 'child', title: 'お子様・浴槽の安全', enabled: true, content: `<h3>入浴の安全</h3><p>浅い水でも溺水の危険があります。乳幼児を浴室に一人にしないでください。使用後は必ずすぐにお湯を抜いてください。</p><h3>窓・階段付近</h3><p>窓辺・階段付近にお子様を一人で近づけないでください。浴室の床は滑りやすいためご注意ください。</p>` }
      ]
    },
    { id: 'trash', category: 'guide', title: 'ゴミ分別', subtitle: 'Waste Management', type: 'builtin', content: `<h3>可燃ごみ</h3><p>生ごみ、紙、ビニール袋、PETボトルとキャップ。</p><h3>資源ごみ</h3><p>洗浄不要。満杯になったらまとめて室内または車庫の大ゴミ箱へ。</p>` },
    { id: 'rules', category: 'guide', title: 'マナー', subtitle: 'Etiquette', type: 'builtin', content: `<p>管理人（男性）が巡回で共用スペースに入ることがあります。入る前に大きな声で挨拶します。</p><p>22:00以降は室内外を静かにお過ごしください。12:00前にチェックアウトをお願いします。</p>` }
  ],

  ko: [
    { id: 'welcome', category: 'checkin', title: '환영', subtitle: 'Welcome', type: 'builtin', content: `<p>환영합니다. 안전하고 편안한 숙박을 위해 각 단계 안내를 확인해 주세요.</p>` },
    { id: 'count', category: 'checkin', title: '인원 수', subtitle: 'Guest Count', type: 'builtin', content: '' },
    { id: 'stayDuration', category: 'checkin', title: '숙박 기간', subtitle: 'Stay Duration', type: 'builtin', content: '' },
    { id: 'privacy', category: 'checkin', title: '개인정보 안내', subtitle: 'Privacy Notice', type: 'builtin', content: `<p><strong>개인정보 처리 안내</strong></p><p>일본 「주택숙박사업법」(2017년 제65호) 제8조 및 「여관업법 시행규칙」(1948년 후생성령 제28호) 제4조에 따라, 본 숙박시설은 숙박자 명부(宿泊者名簿) 작성을 목적으로 아래의 개인정보를 수집합니다.</p><p><strong>수집 항목:</strong> 성명, 주소(일본 거주자), 국적, 여권번호, 여권 사진</p><p><strong>이용 목적:</strong> 법령에 따른 숙박자 명부 기록 및 보관 이외의 목적으로는 사용하지 않습니다.</p><p><strong>보유 기간:</strong> 「여관업법 시행규칙」 제4조 제1항에 따라, 퇴실일로부터 <strong>3년간</strong> 보관합니다.</p><p><strong>관리 책임자:</strong> 본 시설 관리자</p><p><strong>제3자 제공:</strong> 법령에 근거한 행정기관(경찰·보건소 등)의 공식 직권 요청을 제외하고는 제3자에게 일절 제공하지 않습니다.</p><p>「개인정보보호법」에 따라 본인의 정보에 대한 열람·정정·이용 정지·삭제를 요청하실 수 있습니다. 시설 관리자에게 문의해 주세요.</p>` },
    { id: 'registration', category: 'checkin', title: '등록', subtitle: 'Osaka Regulation', type: 'builtin', content: '' },
    {
      id: 'safety', category: 'guide', title: '안전', subtitle: 'Safety', type: 'group', content: '',
      children: [
        { id: 'emergency', title: '긴급', enabled: true, content: `<h3>긴급 번호</h3><ul><li><strong>화재/구급:</strong> 119</li><li><strong>경찰:</strong> 110</li></ul><p>먼저 긴급전화를 하고, 안전을 확인한 후 관리자에게 연락해 주세요.</p>` },
        { id: 'child', title: '어린이·욕조 안전', enabled: true, content: `<h3>욕조 익사 예방</h3><p>얕은 물도 위험합니다. 영아를 욕실에 혼자 두지 마세요. 사용 후에는 반드시 즉시 물을 빼주세요.</p><h3>창가·계단</h3><p>창가·계단 주변에 아이를 혼자 두지 마세요. 욕실 바닥은 미끄러울 수 있으니 주의해 주세요.</p>` }
      ]
    },
    { id: 'trash', category: 'guide', title: '쓰레기 분리', subtitle: 'Waste Management', type: 'builtin', content: `<h3>가연성 쓰레기</h3><p>음식물, 종이, 비닐, PET병과 뚜껑.</p><h3>재활용</h3><p>세척 불필요. 가득 차면 실내 또는 차고 대형 쓰레기통에 넣어주세요.</p>` },
    { id: 'rules', category: 'guide', title: '에티켓', subtitle: 'Etiquette', type: 'builtin', content: `<p>관리자(남성)가 순찰 시 공용 공간에 들어올 수 있습니다. 들어오기 전에 크게 인사를 합니다.</p><p>22:00 이후에는 실내외 정숙 부탁드립니다. 12:00 전에 체크아웃해 주세요.</p>` }
  ]
};

module.exports = STEP_TEMPLATES;
