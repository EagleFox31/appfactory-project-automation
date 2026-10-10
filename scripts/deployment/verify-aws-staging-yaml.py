#!/usr/bin/env python3
"""Fail CI on duplicate/ill-formed AWS CloudFormation staging YAML before AWS."""
from pathlib import Path
import yaml

class UniqueLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if not isinstance(key, str) or key in result:
            raise ValueError(f"Non-string or duplicate YAML key: {key!r}")
        result[key] = loader.construct_object(value_node, deep=True)
    return result

def cfn_tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)

UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)
UniqueLoader.add_multi_constructor("!", cfn_tag)

path = Path("infra/aws/blueprints/reusable-compose-staging-host.yml")
template = yaml.load(path.read_text(encoding="utf8"), Loader=UniqueLoader)
assert isinstance(template, dict)
assert set(template) == {"AWSTemplateFormatVersion", "Description", "Parameters", "Conditions", "Resources", "Outputs"}
assert len(template["Parameters"]) == 10, list(template["Parameters"])
assert set(template["Resources"]) == {
    "StagingSecurityGroup", "StagingInstanceRole", "StagingInstanceProfile",
    "StagingExpiryRole", "StagingExpirySchedule", "StagingInstance"
}
assert template["Resources"]["StagingInstance"]["Properties"]["CreditSpecification"] == ["IsBurstableT3", {"CPUCredits": "standard"}, "AWS::NoValue"]
assert template["Resources"]["StagingExpirySchedule"]["Properties"]["ActionAfterCompletion"] == "DELETE"
assert template["Resources"]["StagingInstance"]["Properties"]["BlockDeviceMappings"][0]["Ebs"]["Encrypted"] is True
bootstrap = Path("infra/aws/blueprints/precis-staging-oidc-cfn-bootstrap.yml")
iam = yaml.load(bootstrap.read_text(encoding="utf8"), Loader=UniqueLoader)
assert set(iam) == {"AWSTemplateFormatVersion", "Description", "Parameters", "Resources", "Outputs"}
assert set(iam["Resources"]) == {
    "StagingInstanceBoundary", "StagingExpiryBoundary",
    "PrecisStagingExecutionRole", "PrecisStagingGitHubRole"
}
assert iam["Resources"]["PrecisStagingGitHubRole"]["Properties"]["RoleName"] == (
    "precis-translation-staging-github-deployer"
)
assert iam["Resources"]["PrecisStagingExecutionRole"]["Properties"]["RoleName"] == (
    "precis-translation-staging-cfn-execution"
)
central_path = Path("infra/aws/appfactory-central-staging-iam-bootstrap.yml")
central = yaml.load(central_path.read_text(encoding="utf8"), Loader=UniqueLoader)
assert set(central) == {"AWSTemplateFormatVersion", "Description", "Resources", "Outputs"}
assert set(central["Resources"]) == {
    "StagingReaderBoundary", "StagingIamCloudFormationRole",
    "AppFactoryStagingIamDeployerRole",
    "StagingInstanceBoundary", "StagingExpiryBoundary",
    "PrecisStagingExecutionRole", "PrecisStagingGitHubRole"
}, "unexpected or missing IAM resource on central stack"
assert all(
    resource["Type"] in {"AWS::IAM::ManagedPolicy", "AWS::IAM::Role"}
    for resource in central["Resources"].values()
), "central update must stay IAM-only, with no EC2"
# Standalone candidate used a parameter reference. The existing central stack
# already knows its GitHub OIDC provider, so bind directly to the same ARN.
github_legacy = iam["Resources"]["PrecisStagingGitHubRole"]
github_central = central["Resources"]["PrecisStagingGitHubRole"]
assert github_central["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]["Principal"]["Federated"] == (
    "arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com"
)
github_legacy["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]["Principal"]["Federated"] = (
    github_central["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]["Principal"]["Federated"]
)
assert github_central == github_legacy
assert central["Resources"]["PrecisStagingExecutionRole"] == iam["Resources"]["PrecisStagingExecutionRole"]
assert central["Resources"]["StagingInstanceBoundary"] == iam["Resources"]["StagingInstanceBoundary"]
assert central["Resources"]["StagingExpiryBoundary"] == iam["Resources"]["StagingExpiryBoundary"]
print("PASS: existing central bootstrap preserves 3 IAM resources and adds exactly 4 reviewed staging IAM resources")
print("PASS: CloudFormation YAML parsed, unique mapping keys, bounded resources and mandatory TTL")
