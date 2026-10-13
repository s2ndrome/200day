// 우클릭·개발자 도구 단축키 막기 (가볍게 막는 용도예요. 완전히 숨길 수는 없어요)
(function () {
  // 휴대폰에서 사진을 길게 눌러 저장하는 메뉴 막기 (iPhone은 touch-callout, 안드로이드는 contextmenu로 막혀요)
  var st = document.createElement('style');
  st.textContent = 'img{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-user-drag:none;}' +
    'body{-webkit-touch-callout:none;}';
  (document.head || document.documentElement).appendChild(st);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('dragstart', function (e) { if (e.target.tagName === 'IMG') e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F12' ||
        (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
        (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c')) ||
        (mod && (k === 'u' || k === 's'))) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
})();
