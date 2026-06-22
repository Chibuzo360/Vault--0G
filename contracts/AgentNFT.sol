// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @title AgentNFT
/// @notice Each Agent Template is a creator-trained AI agent published on 0G.
/// Buyers mint a copy of a template — owning the token is what gives their
/// wallet access to that agent's intelligence via 0G Compute.
/// The raw training content never leaves 0G Storage unencrypted.
contract AgentNFT is ERC721Enumerable {

    // ── Agent Template (defined by creator) ──────────────────────────────────
    struct AgentTemplate {
        uint256 id;
        string  name;
        string  description;      // what this agent knows — shown on marketplace
        string  personality;      // system prompt — defines tone and style, stored on-chain
        string  contentHash;      // 0G Storage root hash of AES-256 encrypted training data
        address creator;
        uint256 totalMinted;      // how many copies have been acquired
    }

    uint256 private _nextTemplateId = 1;
    uint256 private _nextTokenId    = 1;

    mapping(uint256 => AgentTemplate) public templates;   // templateId => template
    mapping(uint256 => uint256) public tokenTemplate;     // tokenId    => templateId

    event TemplateCreated(
        uint256 indexed templateId,
        address indexed creator,
        string name,
        string contentHash
    );

    event AgentMinted(
        address indexed owner,
        uint256 indexed tokenId,
        uint256 indexed templateId
    );

    constructor() ERC721("Vault AI Agent", "VAGENT") {}

    // ── Creator: publish a trained agent ─────────────────────────────────────
    /// @param name         Agent's display name
    /// @param description  What this agent knows — shown on the marketplace
    /// @param personality  System prompt — shapes tone and behaviour
    /// @param contentHash  0G Storage root hash of the encrypted training content
    function createTemplate(
        string calldata name,
        string calldata description,
        string calldata personality,
        string calldata contentHash
    ) external returns (uint256 templateId) {
        require(bytes(name).length > 0,        "Name required");
        require(bytes(contentHash).length > 0, "Content hash required");

        templateId = _nextTemplateId++;
        templates[templateId] = AgentTemplate({
            id:           templateId,
            name:         name,
            description:  description,
            personality:  personality,
            contentHash:  contentHash,
            creator:      msg.sender,
            totalMinted:  0
        });

        emit TemplateCreated(templateId, msg.sender, name, contentHash);
    }

    // ── Buyer: acquire a copy of an agent ────────────────────────────────────
    function mintAgent(uint256 templateId) external returns (uint256 tokenId) {
        require(templates[templateId].creator != address(0), "Template does not exist");

        tokenId = _nextTokenId++;
        tokenTemplate[tokenId] = templateId;
        templates[templateId].totalMinted++;

        _safeMint(msg.sender, tokenId);
        emit AgentMinted(msg.sender, tokenId, templateId);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    /// @notice Does `owner` hold any token for `templateId`?
    function ownsAgent(address owner, uint256 templateId)
        external view returns (bool owns, uint256 tokenId)
    {
        uint256 balance = balanceOf(owner);
        for (uint256 i = 0; i < balance; i++) {
            uint256 tid = tokenOfOwnerByIndex(owner, i);
            if (tokenTemplate[tid] == templateId) {
                return (true, tid);
            }
        }
        return (false, 0);
    }

    /// @notice All templateIds owned by `owner` (deduped — one per template)
    function ownedTemplates(address owner)
        external view returns (uint256[] memory)
    {
        uint256 balance = balanceOf(owner);
        uint256[] memory seen = new uint256[](balance);
        uint256 count = 0;

        for (uint256 i = 0; i < balance; i++) {
            uint256 tid        = tokenOfOwnerByIndex(owner, i);
            uint256 templateId = tokenTemplate[tid];
            bool duplicate     = false;
            for (uint256 j = 0; j < count; j++) {
                if (seen[j] == templateId) { duplicate = true; break; }
            }
            if (!duplicate) seen[count++] = templateId;
        }

        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) result[i] = seen[i];
        return result;
    }

    /// @notice Total number of templates published
    function totalTemplates() external view returns (uint256) {
        return _nextTemplateId - 1;
    }
}
