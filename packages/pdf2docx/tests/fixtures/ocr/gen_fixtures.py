# Regenerates the OCR test pages in this folder (needs Pillow + numpy and the
# Windows fonts below). The committed PNGs are the source of truth for the
# tests; this script only documents how they were made.
#   <name>.png     scan-like page (200 dpi text block, mild noise, 8-level gray palette)
#   <name>.gt.txt  ground truth, one line per text line, reading order
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
FONTS = 'C:/Windows/Fonts/'
np.random.seed(11)

PAGES = {
    'vi': ('times.ttf', [
        'Cộng hòa xã hội chủ nghĩa Việt Nam',
        'Độc lập - Tự do - Hạnh phúc',
        'BIÊN BẢN HỌP BAN QUẢN TRỊ DỰ ÁN',
        'Hôm nay, ngày 15 tháng 9 năm 2026, tại văn phòng công ty ở Hà Nội,',
        'ông Nguyễn Văn Thắng, kỹ sư trưởng, báo cáo việc chuyển đổi dữ liệu',
        'đã hoàn thành tám mươi phần trăm; bà Trần Thị Hương đề nghị bổ sung chức năng',
        'nhận dạng chữ viết tay và kiểm tra quyền truy cập của từng phòng ban.',
        'Những khó khăn chính: thiếu nhân lực kiểm thử, máy chủ dự phòng chưa',
        'được lắp đặt, và một số biểu mẫu cũ vẫn còn lỗi phông chữ tiếng Việt.',
        'Kinh phí phát sinh không vượt quá 125.000.000 đồng; các bên thống nhất',
        'ký tên bên dưới. Người ghi biên bản: Lê Quỳnh Anh, thư ký: Phạm Đức Huy.',
        'Ghi chú: ưu tiên xử lý yêu cầu của khách hàng ở Đà Nẵng và Cần Thơ.',
    ]),
    'en': ('times.ttf', [
        'Minutes of the project steering committee, third meeting',
        'Date: 15 September 2026, 9:00 a.m., Hanoi office, room 3.',
        'The engineering lead reported that the data migration is',
        'eighty percent complete. Finance asked for more testers and',
        'a standby server before the hand-over on 30 October 2026.',
        'Action items: fix legacy form fonts; review access rights;',
        'the budget overrun must stay below VND 125,000,000.',
        'Please send comments to the secretary by the end of the week.',
    ]),
    'fr': ('times.ttf', [
        'Procès-verbal de la réunion du comité de pilotage du projet',
        "Date : le 15 septembre 2026 à 9 h 00, bureau de Hanoï, salle 3.",
        "Le responsable technique a indiqué que la migration des données",
        "est achevée à quatre-vingts pour cent. Le service financier a",
        "demandé davantage de testeurs et un serveur de secours avant la",
        "remise du projet, prévue le 30 octobre 2026, à l'école d'été.",
        "Décisions : corriger les polices des anciens formulaires ; revoir",
        "les droits d'accès ; le dépassement budgétaire ne doit pas excéder",
        "125 000 000 VND. Où est le cœur du problème ? C'est déjà très clair.",
        'Leçon retenue : façonner les règles ensemble, ça marche à chaque fois.',
    ]),
    'zh': ('simsun.ttc', [
        '会议纪要：项目管理委员会第三次会议',
        '时间：二〇二六年九月十五日上午九点',
        '地点：河内办公室第三会议室',
        '一、技术组报告了数据迁移的进度',
        '二、财务部建议增加测试人员的预算',
        '三、各方同意在十月底之前完成剩余工作',
        '四、会议决定下周再次召开评审会议',
    ]),
    # a Vietnamese FORM: fill-in underscore lines, dong amounts, bullets, an e-mail
    # address and `|`-ruled rows: the ASCII symbols the foreign-script gate must not
    # mistake for another script (src/ocr-chain.ts)
    'form': ('times.ttf', [
        'ĐƠN ĐỀ NGHỊ CẤP KINH PHÍ',
        'Họ và tên: ______________________   Ngày sinh: ____/____/______',
        'Phòng ban: ______________________   Điện thoại: ____________',
        'Email: nguyen.van.a@congty.vn',
        '• Mua máy chủ dự phòng: 45.000.000 ₫',
        '• Chi phí kiểm thử và đào tạo: 12.500.000 ₫',
        '| STT | Nội dung | Số tiền (₫) |',
        '| 1 | Máy chủ dự phòng | 45.000.000 |',
        '| 2 | Kiểm thử và đào tạo | 12.500.000 |',
        'Tổng cộng: 57.500.000 ₫',
        'Người đề nghị ký tên: ______________________',
    ]),
}


def render(fname, lines):
    dpi = 200
    px = 31 if fname != 'simsun.ttc' else 36
    gap = round(px * 1.5)
    font = ImageFont.truetype(FONTS + fname, px)
    w = max(round(font.getlength(l)) for l in lines) + 160
    h = gap * len(lines) + 160
    img = Image.new('L', (w, h), 250)
    d = ImageDraw.Draw(img)
    y = 80
    for ln in lines:
        d.text((80, y), ln, font=font, fill=20)
        y += gap
    a = np.asarray(img).astype(np.float32) + np.random.normal(0, 4, (h, w))
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    im = im.rotate(0.3, resample=Image.BICUBIC, fillcolor=245).filter(ImageFilter.GaussianBlur(0.5))
    # 8 gray levels: keeps the file small, the page still looks like a scan
    q = (np.asarray(im) // 32).astype(np.uint8)
    pal = Image.fromarray(q, 'L').convert('P')
    pal.putpalette([v for i in range(8) for v in ((i * 36 + 3,) * 3)] + [0] * (256 - 8) * 3)
    return pal, dpi


for name, (fname, lines) in PAGES.items():
    img, dpi = render(fname, lines)
    img.save(os.path.join(OUT, name + '.png'), optimize=True, dpi=(dpi, dpi))
    with open(os.path.join(OUT, name + '.gt.txt'), 'w', encoding='utf8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print(name, img.size, os.path.getsize(os.path.join(OUT, name + '.png')))
