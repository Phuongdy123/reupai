"""Render the public ReupAI logo, favicon and social preview assets."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "web" / "public"
IMAGES = OUT / "images"
IMAGES.mkdir(parents=True, exist_ok=True)


def logo(size=512):
    scale = 2
    image = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    def box(coords):
        return tuple(round(value * size * scale / 512) for value in coords)
    draw.rounded_rectangle(box((0, 0, 512, 512)), radius=round(116 * size * scale / 512), fill="#0d0b11")
    draw.rounded_rectangle(box((68, 68, 444, 444)), radius=round(91 * size * scale / 512), fill="#19070c", outline="#ff3151", width=round(16 * size * scale / 512))
    for y in (137, 237, 337):
        draw.rounded_rectangle(box((107, y, 133, y + 38)), radius=round(7 * size * scale / 512), fill="#ff3151")
    draw.polygon([box((204, 144))[:2], box((386, 256))[:2], box((204, 368))[:2]], fill="white")
    draw.polygon([box((204, 144))[:2], box((263, 181))[:2], box((263, 331))[:2], box((204, 368))[:2]], fill="#ff3151")
    return image.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")


mark = logo()
mark.save(IMAGES / "reupai-logo.png", optimize=True)
mark.resize((64, 64), Image.Resampling.LANCZOS).save(OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

width, height = 1200, 630
card = Image.new("RGB", (width, height), "#09080d")
pixels = card.load()
for y in range(height):
    for x in range(width):
        glow = max(0, 1 - ((x - 930) ** 2 / 690**2 + (y - 300) ** 2 / 530**2) ** 0.5)
        pixels[x, y] = (int(9 + 45 * glow), int(8 + 3 * glow), int(13 + 12 * glow))
draw = ImageDraw.Draw(card)
draw.rounded_rectangle((48, 48, 1152, 582), radius=46, fill="#100d13", outline="#742033", width=3)
draw.rounded_rectangle((55, 55, 1145, 575), radius=41, outline="#27161f", width=2)
card.paste(mark.resize((142, 142), Image.Resampling.LANCZOS), (95, 100))

font_bold = "C:/Windows/Fonts/arialbd.ttf"
font_regular = "C:/Windows/Fonts/arial.ttf"
draw.text((264, 115), "Reup", font=ImageFont.truetype(font_bold, 94), fill="white")
draw.text((532, 115), "AI", font=ImageFont.truetype(font_bold, 94), fill="#ff3151")
draw.rounded_rectangle((97, 293, 184, 301), radius=4, fill="#ff3151")
draw.text((95, 327), "Từ video nguồn đến thành phẩm", font=ImageFont.truetype(font_bold, 48), fill="white")
draw.text((97, 394), "Vietsub · Lồng tiếng AI · Xử lý trên máy", font=ImageFont.truetype(font_regular, 31), fill="#c5b9c0")
draw.text((97, 509), "www.reupai.cloud", font=ImageFont.truetype(font_regular, 24), fill="#ff6d84")
card.save(IMAGES / "reupai-og.png", optimize=True)

print(f"Created: {IMAGES / 'reupai-logo.png'}, {OUT / 'favicon.ico'}, {IMAGES / 'reupai-og.png'}")
