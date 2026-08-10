import DefaultTheme from "vitepress/theme";

import DemoTabs from "./components/DemoTabs.vue";

import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DemoTabs", DemoTabs);
  },
};
