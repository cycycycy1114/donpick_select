import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { productName, category, deadline, styles } = req.body;
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;

    if (!productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 PRODUCT_DETAIL_DB_ID' });
    }

    if (!productName || !styles || !Array.isArray(styles) || styles.length === 0) {
      return res.status(400).json({ success: false, error: '請提供主商品名稱與至少一個款式資料' });
    }

    // 1. 先在 A 表 (主商品表) 建立或尋找主商品
    let parentPageId = null;
    if (productDbId) {
      const parentRes = await notion.pages.create({
        parent: { database_id: productDbId },
        properties: {
          "商品名稱": { title: [{ text: { content: productName } }] },
          ...(category ? { "分類": { select: { name: category } } } : {}),
          ...(deadline ? { "收單日期": { date: { start: deadline } } } : {})
        }
      });
      parentPageId = parentRes.id;
    }

    // 2. 透過迴圈在 C 表 (款式明細表) 批次建立所有款式
    let createdCount = 0;
    for (const style of styles) {
      const properties = {
        "款式名稱": { title: [{ text: { content: style.styleName || '款式' } }] },
        "價格": { number: Number(style.price) || 0 },
      };

      // 建立與 A 表的關聯 (如果有 A 表的話)
      if (parentPageId) {
        properties["商品"] = { relation: [{ id: parentPageId }] };
      }

      // 處理圖片
      if (style.imageUrl) {
        properties["圖片"] = {
          files: [{ name: "image", external: { url: style.imageUrl } }]
        };
      }

      await notion.pages.create({
        parent: { database_id: productDetailDbId },
        properties: properties
      });
      createdCount++;
    }

    return res.status(200).json({ success: true, message: `成功批次建立 ${createdCount} 個款式！` });

  } catch (error) {
    console.error("Batch Create Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}