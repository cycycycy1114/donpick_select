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

    // 取得 C 表與 A 表的資料庫結構
    const detailDb = await notion.databases.retrieve({ database_id: productDetailDbId });
    const detailProps = detailDb.properties;

    // 💡 印出 Notion 實際欄位名稱，方便你在 Vercel Logs 裡核對！
    console.log("C表所有欄位名稱:", Object.keys(detailProps));

    // 🎯 精準尋找 C 表欄位（不允許模糊亂猜，必須名稱相符或符合特定條件）
    let cTitleKey = null;
    let cPriceKey = null;
    let cRelKey = null;
    let cFileKey = null;
    let cDateKey = null;

    for (const key of Object.keys(detailProps)) {
      const prop = detailProps[key];
      // 標題 (Title)
      if (prop.type === 'title') cTitleKey = key;
      // 單價 / 價格 (Number) - 嚴格排除匯率
      if (prop.type === 'number' && (key.includes('單價') || key.includes('價格') || key.includes('NT') || key.includes('售價')) && !key.includes('匯') && !key.includes('率')) {
        cPriceKey = key;
      }
      // 關聯 (Relation)
      if (prop.type === 'relation') cRelKey = key;
      // 圖片 / 檔案 (Files)
      if (prop.type === 'files' && (key.includes('圖') || key.includes('image') || key.includes('file') || key.includes('相片'))) {
        cFileKey = key;
      }
      // 收單時間 (Date)
      if (prop.type === 'date' && (key.includes('收單') || key.includes('截止') || key.includes('日期'))) {
        cDateKey = key;
      }
    }

    // 如果還是找不到價格，退而求其次抓第一個不是匯率的數字欄位
    if (!cPriceKey) {
      cPriceKey = Object.keys(detailProps).find(k => detailProps[k].type === 'number' && !k.includes('匯') && !k.includes('率'));
    }
    // 如果找不到圖片欄位，抓第一個 files 欄位
    if (!cFileKey) {
      cFileKey = Object.keys(detailProps).find(k => detailProps[k].type === 'files');
    }

    console.log(`欄位對應結果 -> 標題: ${cTitleKey}, 價格: ${cPriceKey}, 關聯: ${cRelKey}, 圖片: ${cFileKey}, 日期: ${cDateKey}`);

    // 1. 建立 A 表 (主商品表)
    let parentPageId = null;
    if (productDbId) {
      const mainDb = await notion.databases.retrieve({ database_id: productDbId });
      const mainProps = mainDb.properties;
      const aTitleKey = Object.keys(mainProps).find(k => mainProps[k].type === 'title');
      const aCatKey = Object.keys(mainProps).find(k => mainProps[k].type === 'select' || mainProps[k].type === 'multi_select');

      const aProperties = {};
      if (aTitleKey) {
        aProperties[aTitleKey] = { title: [{ text: { content: productName } }] };
      }
      if (aCatKey && category) {
        if (mainProps[aCatKey].type === 'select') {
          aProperties[aCatKey] = { select: { name: category } };
        } else if (mainProps[aCatKey].type === 'multi_select') {
          aProperties[aCatKey] = { multi_select: [{ name: category }] };
        }
      }

      const parentRes = await notion.pages.create({
        parent: { database_id: productDbId },
        properties: aProperties
      });
      parentPageId = parentRes.id;
    }

    // 2. 建立 C 表款式明細
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
      if (cDateKey && deadline) {
        cProperties[cDateKey] = { date: { start: deadline } };
      }
      
      // 💡 雙軌並存寫入邏輯
      if (style.imageUrl) {
        // 1. 如果有對應到檔案欄位，且是標準網址，嘗試寫入 Files 欄位
        if (cFileKey && style.imageUrl.startsWith('http')) {
          cProperties[cFileKey] = {
            files: [{ name: "image", external: { url: style.imageUrl } }]
          };
        }

        // 2. 同時將原始資料（無論是短網址還是長 Base64）寫入文字備份欄位（例如叫 "款式圖片備份" 或自動尋找 rich_text 欄位）
        const textImgKey = Object.keys(p).find(k => p[k]?.type === 'rich_text' && (k.includes('圖') || k.includes('image') || k.includes('備份')));
        if (textImgKey) {
          cProperties[textImgKey] = {
            rich_text: [{ text: { content: style.imageUrl.substring(0, 2000) } }] // Notion text 也有上限但比 files 寬容，或可完整存
          };
        }
      }

      await notion.pages.create({
        parent: { database_id: productDetailDbId },
        properties: cProperties
      });
      createdCount++;
    }

    return res.status(200).json({ success: true, message: `成功建立主商品並批次寫入 ${createdCount} 個款式！` });

  } catch (error) {
    console.error("Batch Create Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}