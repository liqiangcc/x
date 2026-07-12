import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export default function useEChart(option) {
  const elementRef = useRef(null);
  useEffect(() => {
    if (!elementRef.current) return undefined;
    const chart = echarts.init(elementRef.current, null, { renderer: "canvas" });
    chart.setOption(option, true);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option]);
  return elementRef;
}
