import { Card, Container, Flex, Heading } from "frosted-ui";
import Form from "./form";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "../api/auth/[...nextauth]/route";
import { api } from "@/trpc/server";

export default async function Page() {
  const user = await api.user.me();
  if (user.isLoggedIn) {
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
