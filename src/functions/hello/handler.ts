import type { APIGatewayProxyResultV2, APIGatewayProxyEventV2 } from 'aws-lambda';

export const main = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from Canaima credito Backend!',
      event,
    }),
  };
};
