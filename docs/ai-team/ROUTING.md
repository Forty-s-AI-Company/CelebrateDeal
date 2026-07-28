# AI Team Lite v5.3 Routing

`route_task` 只回傳建議，不會執行工作。

| 任務類型 | 建議目標 |
| --- | --- |
| planning、major_planning、architecture | Planner：`gpt-5.6-sol`／High |
| explore、find_files、trace_flow | Explorer：Gemini Fast `gemini-3.6-flash-high`／High wrapper |
| analyze、root_cause、dependency_analysis | Analyst：Gemini Deep `gemini-3.1-pro-high`／High wrapper |
| implement、small_feature、bug_fix | Worker：`gpt-5.6-terra`／Medium |
| complex_implementation、cross_file_fix、hard_debugging | Worker Deep：`gpt-5.6-terra`／High |
| review、security_review、regression_review | Reviewer：Gemini Deep `gemini-3.1-pro-high`／High wrapper |
| summarize、classify、log_summary、browser_qa、e2e、ui_validation、quick_second_opinion | Gemini Fast：`gemini-3.6-flash-high`／High |
| deep_review、cross_file_second_opinion、complex_validation | Gemini Deep：`gemini-3.1-pro-high`／High |

同一時間只允許一個可寫代理。Codex 模型只使用 Sol（規劃）與 Terra（主執行／實作）；唯讀探索、分析與審查經明確 Gemini wrapper 執行。模型不可用時不得改用未核准模型；記錄阻擋並由主代理決定下一步。
