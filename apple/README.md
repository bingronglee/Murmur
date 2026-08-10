# VoiceNotesApple MVP

這個 Xcode 專案包含：

- `VoiceNotesWatch`：Apple Watch 錄音、本機保存、背景傳送至 iPhone。
- `VoiceNotesPhone`：接收錄音、保留待上傳佇列、背景上傳與網路恢復後重試。

## 第一次執行

1. 開啟 `VoiceNotesApple.xcodeproj`。
2. 在兩個 Target 的 Signing & Capabilities 選擇你的 Apple Developer Team。
3. 將 iPhone 與 Apple Watch 配對，並在 iPhone 上執行 `VoiceNotesPhone`。
4. iPhone App 預設填的是 `http://localhost:3000/api/upload`；本機測試請改成你電腦的區域網路位址（例如 `http://你的Mac名稱.local:3000/api/upload`），正式部署則填伺服器的網域。
5. 確認 Mac 上的語音記事伺服器已啟動，而且 iPhone 能連到該網址。
6. 安裝 Watch App，在手錶按綠色麥克風開始錄音，按紅色停止。

## MVP 限制

- 第一版由 iPhone 中繼，不支援 Watch 直接用行動網路上傳。
- Watch Connectivity 檔案傳輸必須用實體配對裝置測試。
- Watch Connectivity 的背景傳送時間由 watchOS／iOS 決定，不保證停止錄音後立即送達。

## iPhone 背景同步行為

- iPhone App 安裝後需要至少啟動一次，讓 `WCSession` 完成啟用與上傳網址設定。
- 完成首次啟動後，正常使用時不需要每次手動開啟；Watch Connectivity 可在背景喚醒 iPhone App 接收檔案，背景 `URLSession` 再負責上傳。
- 若使用者從多工畫面強制關閉 App，或開發期間按下 Xcode 的 Stop，背景接收可能暫停，直到再次開啟 App。
- iPhone 與 Watch 暫時離線時，音檔應保留在 Watch；恢復連線後再繼續同步。
- 上線前仍需補上背景 `URLSession` 事件完成處理，並實機驗證鎖定螢幕、App 未開啟、網路中斷後恢復及手機重新開機等情境。

## 待研究：縮短錄音啟停時間，但不增加耗電

### 現況

- 開始錄音時，Watch 需要啟用音訊 Session、取得麥克風路徑、建立檔案並初始化 AAC 編碼器，實機可能需要約 1～3 秒。
- 停止錄音時，需要結束編碼、寫完緩衝資料並封裝 `.m4a`；目前已改在背景完成，畫面會立即顯示處理動畫。
- UI 已提供即時震動、轉圈與狀態文字，但底層啟動時間尚未最佳化。

### 優化目標與限制

- 縮短使用者按下按鈕到真正開始／完成錄音的時間。
- 不長時間保持 Audio Session 或麥克風啟用，不以持續預熱換取速度。
- 不讓待機耗電、背景執行時間或音訊資源占用高於目前版本。

### 後續研究方向

- 在實體 Watch 分段量測權限檢查、Audio Session 啟用、錄音器準備、AAC 啟動及檔案封裝各自耗時，先找出真正瓶頸。
- 排除重複的 Session 設定與不必要的主執行緒工作，重用不耗電的靜態錄音設定資料。
- 評估只在 App 已位於前景、使用者即將操作的極短期間做有限度準備，並確認能源測量不高於基準版本。
- 將「畫面立即回饋」與「實際錄音啟動時間」分開驗證，避免只改善動畫而沒有改善底層延遲。

### 驗收方式

- 比較修改前後多次實機測試的中位數與最慢啟動時間。
- 使用 Xcode Energy／實機耗電觀察，確認待機與一般使用能耗沒有可辨識的增加。
- 確認所有失敗路徑仍會釋放 Audio Session，且不會遺失錄音。
