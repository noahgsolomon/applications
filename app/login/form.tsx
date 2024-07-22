"use client";
import { Button, Flex, TextFieldInput, TextFieldRoot } from "frosted-ui";
import { useRouter } from "next/navigation";
import { FormEvent } from "react";
import { signIn } from "next-auth/react";

export default function Form() {
  const router = useRouter();
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const response = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });

    console.log({ response });
    if (!response?.error) {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Flex direction="column" gap="4">
        <TextFieldRoot>
          <TextFieldInput
            name="email"
            variant="classic"
            size="3"
            placeholder="Enter your email"
            type="email"
            required
          />
        </TextFieldRoot>
        <TextFieldRoot>
          <TextFieldInput
            name="password"
            variant="classic"
            size="3"
            placeholder="Enter your password"
            type="password"
            required
          />
        </TextFieldRoot>
        <Button
          type="submit"
          style={{ cursor: "pointer" }}
          size="3"
          color="orange"
          variant="classic"
          className="w-full"
        >
          Log in
        </Button>
      </Flex>
    </form>
  );
}
