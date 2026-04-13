import { AppConfig } from "../config/schema";

export interface LinearIssueRef {
  id: string;
  identifier?: string;
  url?: string;
  title?: string;
  description?: string;
  parentId?: string;
}

interface LinearIssueNode {
  id: string;
  identifier?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  parent?: { id: string } | null;
}

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

const issueFields = `
  id
  identifier
  url
  title
  description
  parent {
    id
  }
`;

function toLinearIssueRef(issue: LinearIssueNode | null | undefined): LinearIssueRef | null {
  if (!issue) {
    return null;
  }

  return {
    id: issue.id,
    identifier: issue.identifier ?? undefined,
    url: issue.url ?? undefined,
    title: issue.title ?? undefined,
    description: issue.description ?? undefined,
    parentId: issue.parent?.id ?? undefined
  };
}

export class LinearClient {
  private readonly endpoint = "https://api.linear.app/graphql";

  constructor(private readonly config: AppConfig["linear"]) {}

  private get apiKey(): string {
    const apiKey = process.env[this.config.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Linear is enabled but environment variable '${this.config.apiKeyEnv}' is not set.`);
    }

    return apiKey;
  }

  private async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`Linear request failed with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as GraphQLResponse<T>;
    if (body.errors && body.errors.length > 0) {
      throw new Error(body.errors.map((error) => error.message).join("; "));
    }

    if (!body.data) {
      throw new Error("Linear request returned no data.");
    }

    return body.data;
  }

  private looksLikeIssueId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async updateIssue(issueId: string, input: { description?: string; title?: string; stateId?: string }): Promise<void> {
    if (Object.keys(input).length === 0) {
      return;
    }

    const query = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
    `;

    const result = await this.request<{
      issueUpdate: { success: boolean };
    }>(query, { id: issueId, input });

    if (!result.issueUpdate.success) {
      throw new Error(`Failed to update Linear issue ${issueId}.`);
    }
  }

  async createIssue(issue: {
    title: string;
    description: string;
    parentId?: string;
  }): Promise<LinearIssueRef> {
    const query = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
${issueFields}
          }
        }
      }
    `;

    const payload: Record<string, unknown> = {
      teamId: this.config.teamId,
      title: issue.title,
      description: issue.description
    };

    if (issue.parentId) {
      payload.parentId = issue.parentId;
    }

    if (this.config.projectId) {
      payload.projectId = this.config.projectId;
    }

    if (this.config.labelIds.length > 0) {
      payload.labelIds = this.config.labelIds;
    }

    if (this.config.defaultStateIds.started) {
      payload.stateId = this.config.defaultStateIds.started;
    }

    const result = await this.request<{
      issueCreate: {
        success: boolean;
        issue: LinearIssueRef | null;
      };
    }>(query, { input: payload });

    if (!result.issueCreate.success || !result.issueCreate.issue) {
      throw new Error("Linear issue creation failed.");
    }

    const createdIssue = toLinearIssueRef(result.issueCreate.issue);
    if (!createdIssue) {
      throw new Error("Linear issue creation returned no issue payload.");
    }

    return {
      ...createdIssue,
      title: createdIssue.title ?? issue.title,
      description: createdIssue.description ?? issue.description,
      parentId: createdIssue.parentId ?? issue.parentId
    };
  }

  async fetchIssue(issueReference: string): Promise<LinearIssueRef | null> {
    if (this.looksLikeIssueId(issueReference)) {
      return (await this.fetchIssueById(issueReference)) ?? (await this.fetchIssueByIdentifier(issueReference));
    }

    return (await this.fetchIssueByIdentifier(issueReference)) ?? (await this.fetchIssueById(issueReference));
  }

  private async fetchIssueById(issueId: string): Promise<LinearIssueRef | null> {
    const query = `
      query IssueById($id: String!) {
        issue(id: $id) {
${issueFields}
        }
      }
    `;

    const result = await this.request<{
      issue: LinearIssueNode | null;
    }>(query, { id: issueId });

    return toLinearIssueRef(result.issue);
  }

  private async fetchIssueByIdentifier(identifier: string): Promise<LinearIssueRef | null> {
    const query = `
      query IssueByIdentifier($identifier: String!) {
        issues(filter: { identifier: { eq: $identifier } }) {
          nodes {
${issueFields}
          }
        }
      }
    `;

    const result = await this.request<{
      issues: {
        nodes: LinearIssueNode[];
      };
    }>(query, { identifier });

    return toLinearIssueRef(result.issues.nodes[0]);
  }

  async listChildIssues(parentId: string): Promise<LinearIssueRef[]> {
    const query = `
      query ChildIssues($parentId: String!) {
        issues(filter: { parent: { id: { eq: $parentId } } }) {
          nodes {
${issueFields}
          }
        }
      }
    `;

    const result = await this.request<{
      issues: {
        nodes: LinearIssueNode[];
      };
    }>(query, { parentId });

    return result.issues.nodes
      .map((issue) => toLinearIssueRef(issue))
      .filter((issue): issue is LinearIssueRef => issue !== null);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const query = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `;

    const result = await this.request<{
      commentCreate: { success: boolean };
    }>(query, { input: { issueId, body } });

    if (!result.commentCreate.success) {
      throw new Error(`Failed to add Linear comment to issue ${issueId}.`);
    }
  }

  async updateIssueDescription(issueId: string, description: string): Promise<void> {
    await this.updateIssue(issueId, { description });
  }

  async updateIssueTitle(issueId: string, title: string): Promise<void> {
    await this.updateIssue(issueId, { title });
  }

  async updateIssueState(issueId: string, stateId?: string): Promise<void> {
    if (!stateId) {
      return;
    }

    await this.updateIssue(issueId, { stateId });
  }
}