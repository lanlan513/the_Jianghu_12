# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

## 剑鸣（Web Audio 现场合成）

点任意一把剑的「剑鸣」按钮，即可听到由它的属性现场合成的声音——不加载任何音频文件，不引任何音频库，全部振荡器与噪声实时合成：

- **锋利** → 泛音数量、滤波截止（音色明暗）
- **硬度** → 基频高低、衰减快慢
- **柔韧** → 颤音幅度（音分）
- **工艺** → 包络采样点数（包络细腻程度）与起音

声音经 `AnalyserNode` 同步驱动右下角水墨画面（涟漪 / 声波 / 频谱墨点）；静音、暂停、未播放或系统开启「减少动态效果」时，画面退化为静态波形图。同一时刻仅一段剑鸣，切换时旧声部先淡出再停止。

### 可断言数据接口

```js
window.JianMing.params('1')   // → { baseFreq, duration, harmonics, partials, ... }（同剑确定、无随机）
window.JianMing.selfTest()    // → { pass, results }
window.JianMing.state()       // → { enabled, muted, playSeq, currentParams, ... }
```

### 测试

```bash
npm test          # 参数核心自检（13 项）+ 引擎逻辑测试（31 项，Mock Web Audio）
npm run test:e2e  # 真实 Chromium 端到端（需先 npx playwright install chromium）
```
