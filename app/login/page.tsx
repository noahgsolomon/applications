import { Card, Container, Flex, Heading } from "frosted-ui";
import Form from "./form";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function Page() {
  const session = await getServerSession();
  if (session) {
    redirect("/");
  }
  return (
    <Container className="pt-36">
      <Card variant="classic" className="max-w-[95%] w-[400px] mx-auto p-4">
        <Flex direction="column" gap="5">
          <Heading size="6" align="center" mb="2">
            Login to your account
          </Heading>
          <Form />
        </Flex>
      </Card>
    </Container>
  );
}
