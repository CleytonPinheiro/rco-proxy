import { Router } from 'express';
import QRCode      from 'qrcode';

export function createQRCodeRouter() {
    const router = Router();

    /**
     * GET /api/qrcode/generate
     * Parâmetros de query:
     *   text    — texto/URL a codificar (obrigatório)
     *   size    — largura em px (padrão: 256)
     *   level   — nível de correção L/M/Q/H (padrão: M)
     *   color   — cor em hex sem # (padrão: 000000)
     * Retorna: JSON { dataUrl: "data:image/png;base64,..." }
     */
    router.get('/qrcode/generate', async (req, res) => {
        const { text, size = '256', level = 'M', color = '000000' } = req.query;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Parâmetro "text" é obrigatório.' });
        }

        const width = Math.min(Math.max(parseInt(size) || 256, 64), 1024);
        const dark  = `#${color.replace(/^#/, '').slice(0, 6) || '000000'}`;

        const validLevels = ['L', 'M', 'Q', 'H'];
        const errorCorrectionLevel = validLevels.includes(level.toUpperCase())
            ? level.toUpperCase()
            : 'M';

        try {
            const dataUrl = await QRCode.toDataURL(text.trim(), {
                width,
                errorCorrectionLevel,
                margin: 2,
                color: { dark, light: '#ffffff' },
            });

            res.json({ dataUrl });
        } catch (err) {
            console.error('[QRCode] Erro ao gerar:', err.message);
            res.status(500).json({ error: 'Falha ao gerar o QR Code.' });
        }
    });

    return router;
}
