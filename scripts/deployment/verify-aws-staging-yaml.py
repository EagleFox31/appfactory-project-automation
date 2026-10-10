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
print("PASS: CloudFormation YAML parsed, unique mapping keys, bounded resources and mandatory TTL")
