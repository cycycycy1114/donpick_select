// 呼叫 Gemini Vision 模型進行圖片辨識（支援多筆商品清單）
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { inlineData: { data: base64Data, mimeType: mimeType } },
        {
          text: '請幫我辨識這張照片中的所有商品與價格。請回傳一個 JSON 格式（不要有 markdown 程式碼區塊標記，直接回傳純 JSON 陣列）：{"items": [{"productName": "商品名稱或編號", "price": 數字價格}, ...]}'
        }
      ]
    });