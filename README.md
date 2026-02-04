# garmin-connect

## v1.6.0 重構

待辦事項：

-   [x] 新的 HttpClient 類別
-   [x] 登入並取得使用者 token
-   [x] Garmin URL 支援 `garmin.cn` 和 `garmin.com`
-   [x] 自動刷新 OAuth2 token
-   [x] OAuth1、OAuth2 token 匯入與匯出
-   [x] 下載活動、countActivities、getActivities、getActivity、getUserProfile、getUserSettings
-   [x] 上傳活動、刪除活動
-   [ ] 其他方法的實作，例如 Badge、Workout、Gear 等
-   [x] 處理 MFA（支援 Email OTP）
-   [x] 處理帳號鎖定
-   [ ] 單元測試
-   [ ] Listeners

如果功能異常，請先檢查 [https://connect.garmin.com/status/](https://connect.garmin.com/status/)。

目前大部分先前的功能都可正常使用，但部分 REST API 尚未加入，例如 `Gear`、`Workout`、`Badge` 等。如果您需要這些功能，歡迎提交 PR。

以上工作靈感來自 [https://github.com/matin/garth](https://github.com/matin/garth)，非常感謝。

---

一個強大的 JavaScript 函式庫，用於連接 Garmin Connect 來傳送和接收健康與運動數據。它內建了一些預定義方法來取得和設定 Garmin 帳號的不同類型數據，同時也支援[自訂請求](#自訂請求)，目前支援 `GET`、`POST` 和 `PUT`。這讓您可以輕鬆實作任何缺少的功能以滿足需求。

## 前置需求

此函式庫需要您在專案根目錄新增一個名為 `garmin.config.json` 的設定檔，包含您的 Garmin Connect 帳號和密碼。

```json
{
    "username": "my.email@example.com",
    "password": "MySecretPassword"
}
```

## 如何安裝

```shell
$ npm install garmin-connect
```

## 如何使用

```js
const { GarminConnect } = require('garmin-connect');
// 建立新的 Garmin Connect 客戶端
const GCClient = new GarminConnect({
    username: 'my.email@example.com',
    password: 'MySecretPassword'
});
// 使用 garmin.config.json 的憑證或提供的參數
await GCClient.login();
const userProfile = await GCClient.getUserProfile();
```

現在您可以檢查 `userProfile.userName` 來確認登入是否成功。

## MFA（多重要素驗證）支援

如果您的 Garmin 帳號啟用了 MFA，`login()` 會回傳 MFA 結果而非直接完成登入。您需要驗證寄送到您 email 的 MFA 驗證碼。

### 環境設定

設定 `MFA_SECRET_KEY` 環境變數（至少 32 字元）用於加密 MFA 會話狀態：

```bash
export MFA_SECRET_KEY="your-very-long-secret-key-here-32ch"
```

### 基本 MFA 流程

```js
const { GarminConnect } = require('garmin-connect');

const GCClient = new GarminConnect({
    username: 'my.email@example.com',
    password: 'MySecretPassword'
});

const result = await GCClient.login();

// 檢查是否需要 MFA
if ('needsMFA' in result && result.needsMFA) {
    console.log('需要 MFA 驗證！請檢查您的 email 取得驗證碼。');

    // 從使用者取得 MFA 驗證碼（透過提示、API 等）
    const mfaCode = '123456'; // 來自 email 的驗證碼

    // 使用 MFA 完成登入
    await GCClient.verifyMFA(result.mfaSession, mfaCode);
}

// 現在可以正常使用客戶端
const userProfile = await GCClient.getUserProfile();
```

### Web 應用程式（Serverless）流程

對於 Vercel 等 Serverless 環境，MFA 流程跨越兩個 HTTP 請求：

**請求 1 - 初始登入：**

```js
const result = await GCClient.login(email, password);
if (result.needsMFA) {
    // 將 mfaSession 回傳給前端
    return { needsMFA: true, mfaSession: result.mfaSession };
}
```

**請求 2 - MFA 驗證：**

```js
// 從前端接收 mfaSession 和 mfaCode
await GCClient.verifyMFA(mfaSession, mfaCode);
// 登入完成！
```

完整的 Vercel API 實作範例請參考 `examples/api-example.js`。

## 重用會話（v1.6.0 起）

### 儲存 token 至檔案並重用

```js
GCClient.saveTokenToFile('/path/to/save/tokens');
```

結果：

```bash
$ ls /path/to/save/tokens
oauth1_token.json oauth2_token.json
```

重用 token：

```js
GCClient.loadTokenByFile('/path/to/save/tokens');
```

### 或將 token 儲存至資料庫或其他儲存空間

```js
const oauth1 = GCClient.client.oauth1Token;
const oauth2 = GCClient.client.oauth2Token;
// 儲存至資料庫或其他儲存空間
...
```

重用 token：

```js
GCClient.loadToken(oauth1, oauth2);
```

## 重用會話（已棄用）

這是實驗性功能，可能尚未完全穩定。

成功登入後，可以使用 `sessionJson` 的 getter 和 setter 來匯出和還原您的會話。

```js
// 匯出會話
const session = GCClient.sessionJson;

// 使用此方法取代 GCClient.login() 來還原會話
// 如果儲存的會話無法重用，將會拋出錯誤
GCClient.restore(session);
```

匯出的會話可被序列化並儲存為 JSON 字串。

已儲存的會話只能使用一次，每次請求後都需要重新儲存。這可以透過將儲存功能附加到 `sessionChange` 事件來完成。

```js
GCClient.onSessionChange((session) => {
    /*
        在此選擇您的儲存方式
        node-persist 在大多數情況下都能使用
     */
});
```

### 登入備援

為了確保盡可能使用已儲存的會話，但在失敗時回退到一般登入，可以使用 `restoreOrLogin` 方法。
參數 `username` 和 `password` 都是可選的，如果會話還原失敗，將呼叫一般的 `.login()`。

```js
await GCClient.restoreOrLogin(session, username, password);
```

## 事件

-   `sessionChange` 會在 `sessionJson` 變更時觸發

要監聽事件，使用 `.on()` 方法。

```js
GCClient.on('sessionChange', (session) => console.log(session));
```

目前沒有移除 listener 的方法。

## 讀取數據

### 使用者資訊尚未實作 // TODO: 實作此功能

取得基本使用者資訊

```js
GCClient.getUserInfo();
```

### 社交個人資料尚未實作 // TODO: 實作此功能

取得社交使用者資訊

```js
GCClient.getSocialProfile();
```

### 社交連結尚未實作 // TODO: 實作此功能

取得所有社交連結列表

```js
GCClient.getSocialConnections();
```

### 裝置資訊尚未實作 // TODO: 實作此功能

取得所有已註冊裝置的列表，包含型號和韌體版本。

```js
GCClient.getDeviceInfo();
```

### `getActivities(start: number, limit: number, activityType?: ActivityType, subActivityType?: ActivitySubType): Promise<IActivity[]>`

根據指定參數取得活動列表。

#### 參數：

-   `start` (number, 可選)：開始取得活動的索引。
-   `limit` (number, 可選)：要取得的活動數量。
-   `activityType` (ActivityType, 可選)：活動類型（如指定，start 必須為 null）。
-   `subActivityType` (ActivitySubType, 可選)：活動子類型（如指定，start 必須為 null）。

#### 回傳：

-   `Promise<IActivity[]>`：解析為活動陣列的 Promise。

#### 範例：

```js
const activities = await GCClient.getActivities(
    0,
    10,
    ActivityType.Running,
    ActivitySubType.Outdoor
);
```

### `getActivity(activity: { activityId: GCActivityId }): Promise<IActivity>`

根據提供的 `activityId` 取得特定活動的詳細資訊。

#### 參數：

-   `activity` (object)：包含 `activityId` 屬性的物件。

    -   `activityId` (GCActivityId)：所需活動的識別碼。

#### 回傳：

-   `Promise<IActivity>`：解析為指定活動詳細資訊的 Promise。

#### 範例：

```js
const activityDetails = await GCClient.getActivity({
    activityId: 'exampleActivityId'
});
```

### 動態消息尚未實作 // TODO: 實作此功能

要取得動態消息中的活動列表，使用 `getNewsFeed` 方法。此方法接受 _start_ 和 _limit_ 兩個參數用於分頁。兩者都是可選的，預設值為 Garmin Connect 的預設值。為確保取得所有活動，請正確使用此方法。

```js
// 取得預設長度的動態消息，包含最近的活動
GCClient.getNewsFeed();
// 取得動態消息中的活動，第 10 到 15 筆（起始 10，限制 5）
GCClient.getNewsFeed(10, 5);
```

### 下載原始活動數據

使用 activityId 下載原始活動數據。通常以 .zip 檔案提供。

```js
const [activity] = await GCClient.getActivities(0, 1);
// 目錄路徑為可選，預設為當前工作目錄。
// 下載檔名由 Garmin 提供。
GCClient.downloadOriginalActivityData(activity, './some/path/that/exists');
```

### 上傳活動檔案

上傳活動檔案作為新活動。檔案可以是 `gpx`、`tcx` 或 `fit` 格式。如果活動已存在，回應會有 409 狀態碼。
上傳在 1.4.4 版修復，Garmin 更改了上傳 API，回應的 `detailedImportResult` 不再包含新的 activityId。

```js
const upload = await GCClient.uploadActivity('./some/path/to/file.fit');
// 不再可用
const activityId = upload.detailedImportResult.successes[0].internalId;
const uploadId = upload.detailedImportResult.uploadId;
```

### 上傳活動圖片

上傳圖片至活動

```js
const [latestActivty] = await GCClient.getActivities(0, 1);

const upload = await GCClient.uploadImage(
    latestActivty,
    './some/path/to/file.jpg'
);
```

### 刪除活動圖片

從活動中刪除圖片

```js
const [activity] = await GCClient.getActivities(0, 1);
const activityDetails = await GCClient.getActivityDetails(activity.activityId);

await GCClient.deleteImage(
    activity,
    activityDetails.metadataDTO.activityImages[0].imageId
);
```

### `getSteps(date?: Date): Promise<number>`

取得指定日期的總步數。

#### 參數：

-   `date` (Date, 可選)：請求步數資訊的日期；如未提供則預設為今天。

#### 回傳：

-   `Promise<number>`：解析為指定日期總步數的 Promise。

#### 範例：

```js
const totalSteps = await GCClient.getSteps(new Date('2020-03-24'));
```

### `getSleepData(date: string): Promise<SleepData>`

取得指定日期的所有睡眠數據

#### 參數：

-   `date` (Date, 可選)：請求資訊的日期，如未提供則預設為今天

#### 回傳：

-   `Promise<SleepData>`：解析為包含詳細睡眠資訊的物件的 Promise。

    -   `dailySleepDTO` (object)：使用者每日睡眠資訊。
        -   `id` (number)：睡眠記錄的唯一識別碼。
        -   `userProfilePK` (number)：使用者的個人資料識別碼。
        -   `calendarDate` (string)：睡眠記錄的日期。
        -   ...
    -   `sleepMovement` (array)：睡眠動作數據陣列。
    -   `remSleepData` (boolean)：表示是否有 REM 睡眠數據。
    -   `sleepLevels` (array)：睡眠階段數據陣列。
    -   `restlessMomentsCount` (number)：睡眠中不安時刻的計數。
    -   ...

#### 範例：

```js
const detailedSleep = await GCClient.getSleepDuration(new Date('2020-03-24'));
```

### `getSleepDuration(date: string): Promise<{hours: number, minutes: number}`

取得指定日期的睡眠時數和分鐘數

#### 參數：

-   `date` (Date, 可選)：請求資訊的日期，如未提供則預設為今天

#### 回傳：

-   `Promise<{hours: string, minutes: string }>`：解析為包含睡眠時長資訊的物件的 Promise

    -   `hours` (string)：小時數
    -   `minutes` (string)：分鐘數

#### 範例：

```js
const detailedSleep = await GCClient.getSleepDuration(new Date('2020-03-24'));
```

### `getDailyWeightData(date?: Date): Promise<number>`

取得每日體重並從公克轉換為磅。

#### 參數：

-   `date` (Date, 可選)：請求資訊的日期。預設為當前日期。

#### 回傳：

-   `Promise<number>`：解析為從公克轉換為磅的每日體重的 Promise。

#### 拋出：

-   `Error`：如果無法找到指定日期的有效每日體重數據。

#### 範例：

```js
const weightData = await GCClient.getDailyWeightData(new Date('2023-12-25'));
```

### `getDailyWeightInPounds(date?: Date): Promise<number>`

取得指定日期的每日體重（磅）。

#### 參數：

-   `date` (Date, 可選)：請求資訊的日期；如未提供則預設為今天。

#### 回傳：

-   `Promise<number>`：解析為每日體重（磅）的 Promise。

#### 範例：

```js
const weightInPounds = await GCClient.getDailyWeightInPounds(
    new Date('2020-03-24')
);
```

## `getDailyHydration(date?: Date): Promise<number>`

取得每日水分攝取數據並從毫升轉換為盎司。

### 參數：

-   `date` (Date, 可選)：請求資訊的日期。預設為當前日期。

### 回傳：

-   `Promise<number>`：解析為從毫升轉換為盎司的每日水分攝取數據的 Promise。

### 拋出：

-   `Error`：如果無法找到指定日期的有效每日水分攝取數據或回應無效。

### 範例：

```js
const hydrationInOunces = await GCClient.getDailyHydration(
    new Date('2023-12-25')
);
```

### `getGolfSummary(): Promise<GolfSummary>`

取得高爾夫計分卡摘要數據。

#### 回傳：

-   `Promise<GolfSummary>`：解析為高爾夫計分卡摘要的 Promise。

#### 範例：

```js
const golfSummary = await GCClient.getGolfSummary();
```

### `getGolfScorecard(scorecardId: number): Promise<GolfScorecard>`

取得特定計分卡的高爾夫計分卡數據。

#### 參數：

-   `scorecardId` (number)：所需高爾夫計分卡的識別碼。

#### 回傳：

-   `Promise<GolfScorecard>`：解析為高爾夫計分卡數據的 Promise。

#### 範例：

```js
const scorecardId = 123; // 替換為所需的計分卡 ID
const golfScorecard = await GCClient.getGolfScorecard(scorecardId);
```

### `getHeartRate(date?: Date): Promise<HeartRate>`

取得指定日期的每日心率數據。

#### 參數：

-   `date` (Date, 可選)：請求心率數據的日期；如未提供則預設為今天。

#### 回傳：

-   `Promise<HeartRate>`：解析為每日心率數據的 Promise。

#### 範例：

```js
const heartRateData = await GCClient.getHeartRate(new Date('2020-03-24'));
```

## 修改數據

### 更新活動尚未實作 // TODO: 實作此功能

```js
const activities = await GCClient.getActivities(0, 1);
const activity = activities[0];
activity['activityName'] = 'The Updated Name';
await GCClient.updateActivity(activity);
```

### 刪除活動

刪除一個活動。

```js
const activities = await GCClient.getActivities(0, 1);
const activity = activities[0];
await GCClient.deleteActivity(activity);
```

### `updateHydrationLogOunces(date?: Date, valueInOz: number): Promise<WaterIntake>`

為指定日期新增水分攝取記錄（盎司）。

#### 參數：

-   `date` (Date, 可選)：記錄的日期；如未提供則預設為今天。
-   `valueInOz` (number)：水分攝取量（盎司）。接受負數。

#### 回傳：

-   `Promise<WaterIntake>`：解析為水分攝取記錄的 Promise。

#### 範例：

```js
const hydrationLogEntry = await GCClient.addHydrationLogOunces(
    new Date('2020-03-24'),
    16
);
```

### `updateWeight(date = new Date(), lbs: number, timezone: string): Promise<UpdateWeight>`

更新體重資訊

#### 參數：

-   `date` (可選)：代表體重記錄日期的 Date 物件。如未提供則預設為當前日期。
-   `lbs` (number)：體重值（磅）。
-   `timezone` (string)：體重記錄的時區字串。

#### 回傳：

-   `Promise<UpdateWeight>`：解析為體重更新結果的 Promise。

#### 範例：

```js
await GCClient.updateWeight(undefined, 202.9, 'America/Los_Angeles');
```

### 新增訓練計畫

要新增自訂訓練計畫，使用 `addWorkout` 或更具體的 `addRunningWorkout`。

```js
GCClient.addRunningWorkout('My 5k run', 5000, 'Some description');
```

將新增一個名為「My 5k run」的 5 公里跑步訓練計畫，並回傳代表已儲存訓練計畫的 JSON 物件。

### 排程訓練計畫

要將訓練計畫加入行事曆，先找到您的訓練計畫，然後將其加入特定日期。

```js
const workouts = await GCClient.getWorkouts();
const id = workouts[0].workoutId;
GCClient.scheduleWorkout({ workoutId: id }, new Date('2020-03-24'));
```

這會將訓練計畫加入行事曆中的特定日期，如果您使用 Garmin 手錶，它會自動顯示。

### 刪除訓練計畫

刪除訓練計畫與[排程](#排程訓練計畫)非常類似。

```js
const workouts = await GCClient.getWorkouts();
const id = workouts[0].workoutId;
GCClient.deleteWorkout({ workoutId: id });
```

## 自訂請求

此函式庫會處理對您活躍 Garmin Connect 會話的自訂請求。Garmin Connect 使用許多不同的 URL，這表示此函式庫可能無法涵蓋所有 URL。透過使用網路分析工具，您可以找到 Garmin Connect 用來取得數據的 URL。

假設我找到一個 `GET` 請求指向以下 URL：

```
https://connect.garmin.com/modern/proxy/wellness-service/wellness/dailyHeartRate/22f5f84c-de9d-4ad6-97f2-201097b3b983?date=2020-03-24
```

可以使用 `GCClient` 執行此請求：

```js
// 您可以透過 getUserInfo 方法取得 displayName
const displayName = '22f5f84c-de9d-4ad6-97f2-201097b3b983';
const url =
    'https://connect.garmin.com/modern/proxy/wellness-service/wellness/dailyHeartRate/';
const dateString = '2020-03-24';
GCClient.get(url + displayName, { date: dateString });
```

這會得到與使用內建方法相同的結果：

```js
GCClient.getHeartRate();
```

注意客戶端會追蹤 URL、您的使用者資訊，並保持會話活躍。

## 限制

許多 Garmin Connect 的回應缺少型別定義，預設為 `unknown`。歡迎透過提交 PR 來新增型別。

目前此函式庫支援以下功能：

-   取得使用者資訊
-   取得社交使用者資訊
-   取得心率
-   設定體重
-   取得訓練計畫列表
-   新增訓練計畫
-   將訓練計畫加入行事曆
-   移除已新增的訓練計畫
-   取得活動列表
-   取得特定活動的詳細資訊
-   取得步數
-   取得已獲得的徽章
-   取得可用的徽章
-   取得特定徽章的詳細資訊
