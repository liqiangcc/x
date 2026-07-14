import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StrategyRuleBuilder from "./StrategyRuleBuilder.jsx";

const catalog = {
  booleanFeatures: [{ id: "daily.today.is_limit_up", label: "收盘涨停" }],
  features: [{ id: "daily.today.close", label: "今日收盘" }, { id: "daily.previous.close", label: "昨日收盘" }, { id: "yearly.previous.high", label: "去年最高" }],
  indicators: [
    { id: "moving_average", label: "移动平均线 MA", outputs: ["value"], paramSchema: { field: { default: "close", options: ["close"], type: "enum" }, period: { default: 20, max: 500, min: 1, type: "integer" } } },
    { id: "boll", label: "布林线 BOLL", outputs: ["upper", "middle", "lower"], paramSchema: { field: { default: "close", options: ["close"], type: "enum" }, multiplier: { default: 2, max: 10, min: 0.1, type: "number" }, period: { default: 20, max: 500, min: 1, type: "integer" } } },
    { id: "rolling_extreme", label: "滚动最高/最低", outputs: ["value"], paramSchema: {} },
  ],
  rules: [
    { id: "sequence_compare", label: "序列连续比较", paramSchema: {} },
    { id: "value_compare", label: "数值比较", paramSchema: {} },
    { id: "cross", label: "上穿/下穿", paramSchema: { direction: { default: "up", options: ["up", "down"], type: "enum" }, left: { default: "daily.today.close", type: "operand" }, right: { default: "daily.previous.close", type: "operand" } } },
    { id: "first_occurrence", label: "范围内首次满足", paramSchema: {} },
    { id: "boolean_feature", label: "布尔特征判断", paramSchema: { expected: { default: true, type: "boolean" }, feature: { default: "daily.today.is_limit_up", type: "booleanFeature" } } },
    { id: "window_count", label: "窗口出现次数", paramSchema: {} },
    { id: "consecutive_count", label: "连续出现次数", paramSchema: {} },
  ],
};

function definition() {
  return {
    indicators: [],
    operator: "all",
    rules: [{ key: "first", params: { baseline: "yearly.previous.high", comparator: "gt", current: "daily.today.close", historyField: "close", historySource: "daily.current_year_before_today" }, type: "first_occurrence" }],
    schemaVersion: 2,
    templateId: "custom_composite",
    type: "capability_composite",
  };
}

describe("StrategyRuleBuilder", () => {
  it("adds registered indicators through configuration", () => {
    const onChange = vi.fn();
    render(<StrategyRuleBuilder catalog={catalog} definition={definition()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("新增指标类型"), { target: { value: "boll" } });
    fireEvent.click(screen.getByRole("button", { name: "添加指标" }));
    expect(onChange.mock.calls[0][0].indicators[0]).toMatchObject({ key: "boll_1", params: { period: 20 }, type: "boll" });
  });

  it("adds a crossing rule from its capability schema without concrete UI branches", () => {
    const onChange = vi.fn();
    render(<StrategyRuleBuilder catalog={catalog} definition={definition()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("新增规则类型"), { target: { value: "cross" } });
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    const next = onChange.mock.calls[0][0];
    expect(next.indicators).toHaveLength(0);
    expect(next.rules.at(-1)).toMatchObject({ params: { right: "daily.previous.close" }, type: "cross" });
  });

  it("adds a limit-up rule without requiring an indicator", () => {
    const onChange = vi.fn();
    render(<StrategyRuleBuilder catalog={catalog} definition={definition()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("新增规则类型"), { target: { value: "boolean_feature" } });
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    expect(onChange.mock.calls[0][0].rules.at(-1)).toMatchObject({ params: { expected: true, feature: "daily.today.is_limit_up" }, type: "boolean_feature" });
  });
});
