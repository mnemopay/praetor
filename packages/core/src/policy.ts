export interface PolicyRule {
  /** The tool name this rule applies to. Can be a wildcard '*' */
  tool: string;
  /** Action to take: allow or deny */
  action: "allow" | "deny";
  /** Optional regex pattern that the stringified arguments must match to trigger this rule. */
  argsPattern?: string;
  /** Human-readable reason for audit logs */
  reason?: string;
}

export class PolicyEngine {
  private rules: PolicyRule[] = [];

  constructor(rules: PolicyRule[] = []) {
    this.rules = rules;
  }

  addRule(rule: PolicyRule) {
    this.rules.push(rule);
  }

  evaluate(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string } {
    const argsStr = JSON.stringify(args);
    
    // Evaluate rules in reverse order (last added has highest priority)
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i];
      if (rule.tool === "*" || rule.tool === toolName) {
        if (rule.argsPattern) {
          const regex = new RegExp(rule.argsPattern);
          if (!regex.test(argsStr)) continue; // Skip if args don't match pattern
        }
        
        if (rule.action === "deny") {
          return { allowed: false, reason: rule.reason || `Denied by policy rule: ${rule.tool}` };
        } else if (rule.action === "allow") {
          return { allowed: true, reason: rule.reason };
        }
      }
    }
    
    // Default allow if no rules matched
    return { allowed: true };
  }
}
