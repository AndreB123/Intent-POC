import { AppConfig } from "../config/schema";

export interface LinearIssueRef {
  id: string;
  identifier?: string;
  url?: string;
  title?: string;
  parentId?: string;
}

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
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
            id
            identifier
            url
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

    return {
      ...result.issueCreate.issue,
      title: issue.title,
      parentId: issue.parentId
    };
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

  async updateIssueState(issueId: string, stateId?: string): Promise<void> {
    if (!stateId) {
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
    }>(query, { id: issueId, input: { stateId } });

    if (!result.issueUpdate.success) {
      throw new Error(`Failed to update Linear issue state for ${issueId}.`);
    }
  }
}