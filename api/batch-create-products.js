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

    // 輔助函式：自動尋找 Notion 資料庫中符合關鍵字的欄位名稱
    async function getDbPropertyKey(dbId, keywords, expectedType) {
      const db = await notion.databases.retrieve({ database_id: dbId });
      const props = db.properties;
      for (const key of Object.keys(props)) {
        const prop = props[key];
        const matchName = keywords.some(kw => key.includes(kw));
        const matchType = !expectedType || prop.type === expectedType || (expectedType === 'title' && prop.type === 'title');
        if (matchName && matchType) {
          return key;
        }
      }
      // 如果找不到符合關鍵字的，就找第一個符合類型的欄位
      for (const key of Object.keys(props)) {
        if (!expectedType || props[key].type === expectedType) {
          return key;
        }
      }
      return null;
    }

    // 1. 動態取得 A 表 (主商品表) 的正確欄位名稱
    let parentPageId = null;
    if (productDbId) {
      const aTitleKey = await getDbPropertyKey(productDbId, ['商品', '名稱', '標題', 'Name'], 'title');
      const aCatKey = await getDbPropertyKey(productDbId, ['分類', '地區', 'category'], null);
      const aDateKey = await getDbPropertyKey(productDbId, ['收單', '截止', '日期', 'date'], 'date');

      const aProperties = {};
      if (aTitleKey) {
        aProperties[aTitleKey] = { title: [{ text: { content: productName } }] };
      }
      if (aCatKey && category) {
        const catPropType = (await notion.databases.retrieve({ database_id: productDbId })).properties[aCatKey].type;
        if (catPropType === 'select') {
          aProperties[aCatKey] = { select: { name: category } };
        } else if (catPropType === 'multi_select') {
          aProperties[aCatKey] = { multi_select: [{ name: category }] };
        } else if (catPropType === 'rich_text') {
          aProperties[aCatKey] = { rich_text: [{ text: { content: category } }] };
        }
      }
      if (aDateKey && deadline) {
        aProperties[aDateKey] = { date: { start: deadline } };
      }

      const parentRes = await notion.pages.create({
        parent: { database_id: productDbId },
        properties: aProperties
      });
      parentPageId = parentRes.id;
    }

    // 2. 動態取得 C 表 (款式明細表) 的正確欄位名稱
    const cTitleKey = await getDbPropertyKey(productDetailDbId, ['款式', '名稱', '品名', 'Title', 'Name'], 'title');
    const cPriceKey = await getDbPropertyKey(productDetailDbId, ['價', 'price', 'NT', '金額'], 'number');
    const cRelKey = await getDbPropertyKey(productDetailDbId, ['商品', '主商品', 'relation'], 'relation');
    const cFileKey = await getDbPropertyKey(productDetailDbId, ['圖', 'image', 'file'], 'files');

    let createdCount = 0;
    for (const style of styles) {
      const cProperties = {};

      if (cTitleKey) {
        cProperties[cTitleKey] = { title: [{ text: { content: style.styleName || '圖片款' } }] };
      }
      if (cPriceKey) {
        cProperties[cPriceKey] = { number: Number(style.price) || 0 };
      }
      if (parentPageId && cRelKey) {
        cProperties[cRelKey] = { relation: [{ id: parentPageId }] };
      }
      if (style.imageUrl && cFileKey) {
        cProperties[cFileKey] = {
          files: [{ name: "image", external: { url: style.imageUrl } }]
        };
      }

      await notion.pages.create({
        parent: { database_id: productDetailDbId },
        properties: cProperties
      });
      createdCount++;
    }

    return res.status(200).json({ success: true, message: `成功批次建立 ${createdCount} 個款式！` });

  } catch (error) {
    console.error("Batch Create Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}