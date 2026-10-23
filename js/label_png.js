import { qrGeometry } from './label_model.js';

export function pngDimensions(dpi) {
    if (![203, 300].includes(dpi)) throw new Error('PNG 僅支援 203 或 300 dpi');
    return { width: Math.round(80 / 25.4 * dpi), height: Math.round(50 / 25.4 * dpi) };
}
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
// Canvas defaults to 96 dpi. Store the selected physical pixel density in a PNG pHYs chunk.
export async function setPngDpi(blob, dpi) {
    pngDimensions(dpi);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((value, i) => bytes[i] === value)) throw new Error('PNG 圖檔格式不正確');
    const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
    view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
    const density = Math.round(dpi / .0254);
    view.setUint32(8, density); view.setUint32(12, density); chunk[16] = 1;
    view.setUint32(17, crc32(chunk.subarray(4, 17)));
    const parts = [bytes.subarray(0, 8)], input = new DataView(bytes.buffer);
    let inserted = false, ended = false;
    for (let offset = 8; offset < bytes.length;) {
        if (offset + 12 > bytes.length) throw new Error('PNG 圖檔不完整');
        const length = input.getUint32(offset), end = offset + 12 + length;
        if (end > bytes.length) throw new Error('PNG 圖檔不完整');
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === 'IDAT' && !inserted) { parts.push(chunk); inserted = true; }
        if (type !== 'pHYs') parts.push(bytes.subarray(offset, end));
        if (type === 'IEND') ended = true;
        offset = end;
    }
    if (!inserted || !ended) throw new Error('PNG 圖檔缺少影像資料');
    return new Blob(parts, { type: 'image/png' });
}

export async function renderLabelPng(label, dpi, qr) {
    const { width, height } = pngDimensions(dpi);
    if (!window.htmlToImage?.toCanvas) throw new Error('PNG 模組載入失敗，請重新整理');
    await document.fonts.ready;
    const logo = label.querySelector('.label-logo');
    await logo.decode();
    const rect = label.getBoundingClientRect(), qrRect = label.querySelector('.label-qr').getBoundingClientRect();
    const geometry = qrGeometry(qr.getModuleCount(), dpi);
    if (!geometry.valid) throw new Error('QR 密度不足，不能輸出 PNG');
    const canvas = await window.htmlToImage.toCanvas(label, {
        width: 80 * 96 / 25.4, height: 50 * 96 / 25.4,
        canvasWidth: width, canvasHeight: height, pixelRatio: 1,
        backgroundColor: '#fff', skipFonts: true, style: { boxShadow: 'none', margin: '0', transform: 'none' }
    });
    const context = canvas.getContext('2d');
    if (!context || canvas.width !== width || canvas.height !== height) throw new Error('PNG 尺寸不正確，未下載');
    // Redraw the QR on whole output pixels so the DOM rasterization cannot blur its modules.
    const x = Math.round((qrRect.left - rect.left) / rect.width * width);
    const y = Math.round((qrRect.top - rect.top) / rect.height * height);
    const dots = geometry.dotsPerModule, size = geometry.totalModules * dots;
    context.fillStyle = '#fff'; context.fillRect(x - 1, y - 1, size + 2, size + 2);
    context.fillStyle = '#000';
    for (let row = 0; row < qr.getModuleCount(); row++) for (let col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col)) context.fillRect(x + (col + 4) * dots, y + (row + 4) * dots, dots, dots);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('無法產生 PNG，請改用瀏覽器列印');
    return setPngDpi(blob, dpi);
}
