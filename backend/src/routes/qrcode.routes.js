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

    /**
     * GET /api/qrcode/matrix
     * Retorna a matriz booleana do QR Code para renderização customizada no frontend.
     * Parâmetros:
     *   text  — texto/URL a codificar (obrigatório)
     *   level — nível de correção L/M/Q/H (padrão: M)
     * Retorna: { moduleCount, data: boolean[] }
     */
    router.get('/qrcode/matrix', async (req, res) => {
        const { text, level = 'M' } = req.query;

        if (!text?.trim()) {
            return res.status(400).json({ error: 'Parâmetro "text" é obrigatório.' });
        }

        const validLevels = ['L', 'M', 'Q', 'H'];
        const errorCorrectionLevel = validLevels.includes(level.toUpperCase())
            ? level.toUpperCase()
            : 'M';

        try {
            const qr          = QRCode.create(text.trim(), { errorCorrectionLevel });
            const moduleCount = qr.modules.size;
            const data        = Array.from(qr.modules.data).map(v => v > 0);
            res.json({ moduleCount, data });
        } catch (err) {
            console.error('[QRCode Matrix] Erro ao gerar:', err.message);
            res.status(500).json({ error: 'Falha ao gerar a matriz QR.' });
        }
    });

    return router;
}
